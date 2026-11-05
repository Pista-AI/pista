/**
 * Deterministic playbook replay: runs a recorded path (start page, clicks, sign-in, waits, one download) through the same
 * machinery the browser tools use, with no model calls. It stops at the first step it cannot do with certainty and hands the
 * page back as data. Conservative by design: a wrong click is worse than a handoff.
 *
 * The step types mirror `PlaybookStep` in @pista/protocol structurally; pi-browser does not depend on the protocol package.
 */
import { declineCookieBanner, runPageAction, settle, waitForLoad, type Approve } from "./actions.ts";
import { checkUrl, DomainBlockedError, guardDriver, type DomainRules } from "./domains.ts";
import { readFileSync } from "node:fs";
import { isWebPage, readHead, refDownloadSource, saveDownload } from "./download.ts";
import type { BrowserDriver } from "./driver.ts";
import { describeCandidate, fullDateCount, isPeriodLabel, matchPeriod, matchRows, parseAmounts, parseDates, rowTextOf, type MatchedBy, type RowMatch } from "./row-match.ts";
import { call, formatSnapshot, scripts, type PageSnapshot } from "./page-scripts.ts";

/** What a row is matched on. Mirrors the protocol type; pi-browser does not depend on protocol (the host test checks they agree). */
export type ReplayRowMatch = ("date" | "amount")[];
export interface ReplayLocator { role?: string; name?: string; text?: string; selector?: string; frameUrl?: string; row?: { match: ReplayRowMatch }; period?: boolean }
export interface ReplayExpect { urlIncludes?: string; text?: string; element?: ReplayLocator }
export type ReplayStep =
  | { kind: "navigate"; url: string; expect?: ReplayExpect }
  | { kind: "click"; target: ReplayLocator; fallbacks?: ReplayLocator[]; expect?: ReplayExpect; opensTab?: true }
  | { kind: "signIn"; origin: string; expect?: ReplayExpect }
  | { kind: "wait"; expect: ReplayExpect }
  | { kind: "download"; target?: ReplayLocator; url?: string; fileType?: string; verify?: "row" | "page" };

export type ReplayReason = "not-found" | "ambiguous" | "expectation-timeout" | "blocked" | "declined" | "aborted" | "sign-in-needed" | "row-not-found" | "row-ambiguous" | "row-not-verified" | "needs-invoice" | "error";

/**
 * What a run compared with the invoice. `amount: true` means the amount was verified, including by a band check on a charge in
 * another currency: then `matchedBy` includes "amount-fx" and `fxRateUsed` is the rate the scorer applied (a table rate unless the
 * caller gave one), while `fxRateImplied` is the real rate (invoice amount / row amount) a consumer may learn from.
 */
export type Verified = {
  date: boolean;
  amount: boolean;
  /** the amount could not be verified: the row or page showed only another currency (or none comparable), so the date alone was compared */
  foreignCurrency?: true;
  matchedBy?: MatchedBy[];
  fxRateUsed?: number;
  /** bank date minus row or page date, in days (positive: the vendor's date precedes the charge) */
  offsetDays?: number;
  /** the matched row's or page's amount (absolute) and currency code when known */
  rowAmount?: number;
  rowCurrency?: string;
  /** invoice amount / row amount, when the currencies differ */
  fxRateImplied?: number;
};

/**
 * Either the saved file, or a handoff at the first step that failed. `failedIndex` numbers steps from 1 like the stored playbook;
 * 0 is the start page. The handoff's `detail`, `url` and `snapshot` come from the website: they are data for the model, not instructions.
 */
export type ReplayResult =
  | {
    ok: true;
    download: { path: string; bytes: number; contentType?: string };
    steps: number;
    /** The page address after each step (0 is the start page), "" for one a shortcut skipped. */ urls: string[];
    /** Which fields of the invoice a row or period check compared on the way (nothing is claimed when no invoice was given or no check applied). */ verified: Verified;
    /** Things the run did that a person should know about (for example a repeated click that left several tabs open). */ notes?: string[];
    shortcut?: ReplayShortcutOutcome;
  }
  | { ok: false; failedIndex: number; step: ReplayStep; reason: ReplayReason; detail: string; url: string; snapshot: string; shortcut?: ReplayShortcutOutcome };

/** "used": the run opened the shortcut and skipped the earlier steps. "failed": the shortcut page did not check out, so the full path ran instead. */
export type ReplayShortcutOutcome = "used" | "failed";
export interface ReplayOptions {
  /** The raw driver; replay wraps it in the same domain guard the browser tools use. */
  driver: BrowserDriver;
  /**
   * Whether replay may open or download `url` (the host: same site as the playbook). Asked for the start page, every navigate and
   * download address, resolved download links, and the page address after each navigation, click and sign-in. Only http(s) ever passes.
   */
  allowUrl: (url: string) => boolean;
  domainRules?: DomainRules;
  onDomainBlock?: (reason: string) => void;
  /** Folder the download is confined to, and the path under it (relative, like browser_download's `path`). */
  downloadRoot: string;
  downloadPath: string;
  overwrite?: boolean;
  /** The invoice the job wants (date as yyyy-mm-dd, amount and currency from the bank transaction): picks the row for a locator with `row`. */
  invoice?: { date: string; amount?: number; currency?: string; /** text from the transaction (an invoice or order number) that a row may show */ reference?: string };
  /** Asked before each click, sign-in and download; false stops with "declined". */
  approve?: (step: ReplayStep, index: number) => Promise<boolean>;
  /** Asked about a held consequential click (see safety.ts), naming it exactly; without it the stop stands and replay hands off. */
  confirmRisk?: (action: string) => Promise<boolean>;
  signal?: AbortSignal;
  onStep?: (index: number, status: "start" | "done" | "failed") => void;
  /** Expectation polling (defaults 10 s every 250 ms), the download deadline (default 60 s) and the clock, injectable for tests. */
  expectTimeoutMs?: number;
  downloadTimeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DETAIL_MAX = 300;
const URL_MAX = 500;
/** Longest address quoted in a blocked-page message. */
const BLOCKED_URL_MAX = 200;
const SNAPSHOT_MAX = 8000;
const RESOLVE_MAX_ELEMENTS = 500;
/** A control that is not there yet (a late-hydrating page) is looked for this long before it counts as not found. */
const LOCATE_WAIT_MS = 3000;
const LOCATE_POLL_MS = 250;
/** How long a click that should open a tab is given to show it before the click is repeated. */
const NEW_TAB_WAIT_MS = 1000;
/** How many times a link that should open a tab is clicked again when none showed. */
const MAX_TAB_RETRIES = 1;

class Handoff extends Error {
  constructor(readonly reason: ReplayReason, detail: string) {
    super(detail);
  }
}

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** What the matcher found for the chosen row. */
export type Seen = { amount: boolean; foreign?: boolean; matchedBy?: MatchedBy[]; fxRateUsed?: number; offsetDays?: number; rowAmount?: number; rowCurrency?: string; fxRateImplied?: number };
export type Resolution = { target: string; seen?: Seen } | { reason: "not-found" | "ambiguous" | "row-not-found" | "row-ambiguous"; detail: string; /** nothing to choose from yet (no period labels), so the page may still be building */ empty?: true };
type Candidate = { ref: string; role: string; name: string; href?: string };

const tiersOf = (l: ReplayLocator): ((e: Candidate) => boolean)[] => {
  const tiers: ((e: Candidate) => boolean)[] = [];
  if (l.role && l.name) tiers.push((e) => e.role === l.role && norm(e.name) === norm(l.name));
  if (l.name) tiers.push((e) => norm(e.name) === norm(l.name));
  if (l.text && norm(l.text)) tiers.push((e) => (!l.role || e.role === l.role) && norm(e.name).includes(norm(l.text)));
  return tiers;
};

/** Every element of the first tier that has any hit, for the target and then each fallback: the repeated elements a row is chosen from. */
export function resolveAll(elements: readonly Candidate[], target: ReplayLocator, fallbacks: readonly ReplayLocator[] = []): string[] {
  for (const l of [target, ...fallbacks]) {
    for (const tier of tiersOf(l)) {
      const hits = elements.filter(tier);
      if (hits.length) return hits.map((h) => h.ref);
    }
  }
  return [];
}

const describeInvoice = (i: { date: string; amount?: number; currency?: string }) =>
  `the invoice dated ${i.date.slice(0, 10)}${i.amount !== undefined ? `, amount ${i.amount}${i.currency ? ` ${i.currency.slice(0, 3)}` : ""}` : ""}`;

const seenOf = (m: Extract<RowMatch, { kind: "one" }>, byAmount: boolean): Seen => ({ amount: byAmount && m.amountVerified, ...(byAmount && !m.amountVerified ? { foreign: true } : {}), matchedBy: m.matchedBy, offsetDays: m.offsetDays, ...(m.fxRateUsed !== undefined ? { fxRateUsed: m.fxRateUsed } : {}), ...(m.rowAmount !== undefined ? { rowAmount: m.rowAmount } : {}), ...(m.rowCurrency ? { rowCurrency: m.rowCurrency } : {}), ...(m.fxRateImplied !== undefined ? { fxRateImplied: m.fxRateImplied } : {}) });

/** Chooses one of `refs` by the text of its row. Exactly one match gives its ref; none or several is a handoff, never a guess. */
export function pickRow(refs: readonly string[], rowTexts: readonly (string | null)[], invoice: NonNullable<ReplayOptions["invoice"]>, by: readonly ("date" | "amount")[]): Resolution {
  const looking = describeInvoice(invoice);
  const ambiguous = (why: string): Resolution => ({ reason: "row-ambiguous", detail: `${why}; looking for ${looking}.` });
  if (rowTexts.length < refs.length || rowTexts.slice(0, refs.length).some((t) => t === null || t === undefined)) return ambiguous("A candidate's row could not be read");
  if (new Set(rowTexts).size < refs.length) return ambiguous("Several candidates have identical rows");
  if (rowTexts.some((t) => new Set(parseDates(t!).filter((d) => d.d).map((d) => d.raw)).size > 3)) return ambiguous("A row holds too many dates to be one invoice");
  const byAmount = by.includes("amount") && invoice.amount !== undefined;
  const m = matchRows(refs.map((_, i) => ({ index: i, text: rowTexts[i] ?? "" })), { date: invoice.date, reference: invoice.reference, ...(byAmount ? { amount: invoice.amount, currency: invoice.currency } : {}) });
  if (m.kind === "one") return { target: refs[m.index]!, seen: seenOf(m, byAmount && parseAmounts(rowTexts[m.index] ?? "", { strict: true }).length > 0) };
  if (m.kind === "none") return { reason: "row-not-found", detail: `No row of ${refs.length} matches ${looking}.` };
  return { reason: "row-ambiguous", detail: `${m.candidates.length} rows match ${looking}: ${m.details.slice(0, 5).map((c) => describeCandidate(c, invoice)).join("; ")}.` };
}

/**
 * A single element found without a row rule, checked against the invoice before it is acted on: its row (see rowTextOf) must show
 * the invoice's date and no more than 3 distinct dates. The detail never quotes the row's text.
 */
export function verifySingleRow(rowText: string, invoice: NonNullable<ReplayOptions["invoice"]>): ({ ok: true; amount: boolean; amountVerified?: false } & Omit<Seen, "amount" | "foreign">) | { ok: false; detail: string } {
  const fail = (why: string) => ({ ok: false as const, detail: why });
  const date = invoice.date.slice(0, 10);
  if (fullDateCount(rowText) !== 1) return fail(`row doesn't show exactly one date to compare with the invoice date ${date}`);
  // The amount counts whenever the text shows one; a text without any amount is judged by its date alone.
  const byAmount = invoice.amount !== undefined && parseAmounts(rowText, { strict: true }).length > 0;
  const m = matchRows([{ index: 0, text: rowText }], { date: invoice.date, reference: invoice.reference, ...(byAmount ? { amount: invoice.amount, currency: invoice.currency } : {}) });
  if (m.kind !== "one") return fail(`row doesn't show the invoice date ${date}${byAmount ? " and amount" : ""}`);
  const { foreign, ...seen } = seenOf(m, byAmount);
  return { ok: true, ...seen, ...(foreign ? { amountVerified: false as const } : {}) };
}

/** Longest page text read for verification; capture and replay both cut at this, so they judge the same text. */
export const PAGE_TEXT_MAX = 20_000;
/** A page with more distinct dates than this (invoice, due, paid) is a list or a statement, not one invoice. */
const PAGE_DATES_MAX = 3;

function foreignPageIsOneInvoice(text: string, date: string): boolean {
  const ds = new Map(parseDates(text).filter((d) => d.d).map((d) => [d.raw, d] as const));
  if (ds.size > 2) return false;
  if (new Set(parseAmounts(text, { strict: true }).filter((a) => a.value !== 0).map((a) => a.value)).size > 1) return false; // a detail page repeats its total; a list shows several
  const [y, m, d0] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d0) / 86400000;
  const off = [...ds.values()].map((d) => Date.UTC(d.y, d.m - 1, d.d!) / 86400000 - t);
  // One date is the invoice's; another may only be a due date (not before it, at most 45 days after).
  return off.some((o) => Math.abs(o) <= 3) && off.every((o) => Math.abs(o) <= 3 || (o >= 0 && o <= 45));
}

/**
 * Verifies the invoice on a detail page (the download control sits in no row): the page text must show the invoice date and, when the
 * invoice has an amount, that amount (strictly parsed; the date alone is not enough). Same date tolerance as a row. The detail never quotes the page's text.
 */
export function verifyPage(pageText: string, invoice: NonNullable<ReplayOptions["invoice"]>): ({ ok: true; amount: boolean; amountVerified?: false } & Omit<Seen, "amount" | "foreign">) | { ok: false; detail: string } {
  const text = pageText.slice(0, PAGE_TEXT_MAX);
  const date = invoice.date.slice(0, 10);
  if (fullDateCount(text) > PAGE_DATES_MAX) return { ok: false, detail: `page shows too many dates to be one invoice (looking for ${date})` };
  const dateSeen = matchRows([{ index: 0, text }], { date: invoice.date }).kind === "one";
  const m = matchRows([{ index: 0, text }], { date: invoice.date, reference: invoice.reference, ...(invoice.amount !== undefined ? { amount: invoice.amount, currency: invoice.currency } : {}) });
  if (m.kind === "one") {
    const seen = seenOf(m, invoice.amount !== undefined);
    if (invoice.amount === undefined || (m.amountVerified && m.matchedBy.includes("amount"))) return { ok: true, ...seen, ...(seen.foreign ? { amountVerified: false as const } : {}) };
    // The amount was verified only through a rate, or could not be (the page shows amounts only in another currency): the date and the
    // invoice-like checks are what it can prove. Stricter than the same-currency path, as a rate cannot tell an invoice from a list:
    // at most 2 dates (the invoice's, plus a due date), one amount.
    if (parseAmounts(text, { strict: true }).length > 0 && foreignPageIsOneInvoice(text, invoice.date)) {
      const { foreign, ...rest } = seen;
      return { ok: true, ...rest, ...(foreign ? { amountVerified: false as const } : {}) };
    }
  }
  return { ok: false, detail: dateSeen ? "page shows the date but not the amount" : m.kind === "many" ? `page's date and amount are ambiguous (looking for ${date})` : `page showed neither the invoice date ${date} nor its amount` };
}

/** The text a lone element is verified on: the row it sits in (see rowTextOf), "" when no level shows exactly one date. */
export async function loneRowText(d: BrowserDriver, ref: string): Promise<string> {
  return rowTextOf((await d.evaluate(scripts.rowChain(ref)).catch(() => null)) as string[] | null);
}

/**
 * Finds the element for `target`, then each fallback in order. Per locator: exact role + name, then exact name, then name containing
 * `text` (same role when one is given), then `selector` when the page has exactly one match (`selectors`: match counts). Several
 * matches in a tier are "ambiguous" and nothing further is tried, except identical links to the same address (the first is taken).
 * `frameUrl` is not used: snapshots do not enter frames, so playbooks open a frame's address with a navigate step.
 */
export function resolveLocator(elements: readonly Candidate[], target: ReplayLocator, fallbacks: readonly ReplayLocator[] = [], selectors: ReadonlyMap<string, number> = new Map()): Resolution {
  for (const l of [target, ...fallbacks]) {
    for (const tier of tiersOf(l)) {
      const hits = elements.filter(tier);
      if (!hits.length) continue;
      const first = hits[0]!;
      const sameLink = (h: Candidate) => h.role === "link" && !!first.href && h.href === first.href && norm(h.name) === norm(first.name);
      if (hits.length > 1 && !(first.role === "link" && hits.every(sameLink))) return { reason: "ambiguous", detail: `${hits.length} elements match ${describeLocator(l)}` };
      return { target: first.ref };
    }
    // A selector that looks like a ref would be taken as one by the click action.
    const count = l.selector && !/^e\d+$/.test(l.selector) ? (selectors.get(l.selector) ?? 0) : 0;
    if (count > 1) return { reason: "ambiguous", detail: `${count} elements match ${describeLocator(l)}` };
    if (count === 1) return { target: l.selector! };
  }
  return { reason: "not-found", detail: `nothing on the page matches ${describeLocator(target)}` };
}

const describeLocator = (l: ReplayLocator) => [l.role, l.name ? JSON.stringify(l.name) : l.text ? `~${JSON.stringify(l.text)}` : "", l.selector ?? ""].filter(Boolean).join(" ").slice(0, 120);

const stopped = () => new Handoff("aborted", "The run was stopped.");

/** `p`, unless `signal` fires (aborted) or `ms` passes (`onTimeout`) first. */
async function within<T>(p: Promise<T>, ms: number, signal: AbortSignal | undefined, onTimeout: () => T | never): Promise<T> {
  if (signal?.aborted) throw stopped();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => {
          try {
            resolve(onTimeout());
          } catch (e) {
            reject(e);
          }
        }, Math.max(0, ms));
        signal?.addEventListener("abort", (onAbort = () => reject(stopped())), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/** Polls `check` until it is true or `timeoutMs` has passed (checked at least once). A blocked page and a stop end it at once. */
export async function pollUntil(check: () => Promise<boolean>, timeoutMs: number, pollMs: number, now: () => number, sleep: (ms: number) => Promise<void>, signal?: AbortSignal): Promise<boolean> {
  const start = now();
  for (;;) {
    const left = timeoutMs - (now() - start);
    const ok = await within(check(), left, signal, () => false).catch((e) => {
      if (e instanceof DomainBlockedError || e instanceof Handoff) throw e;
      return false;
    });
    if (ok) return true;
    if (now() - start >= timeoutMs) return false;
    await within(sleep(pollMs), pollMs + 1000, signal, () => undefined);
  }
}

const snapshotOf = async (d: BrowserDriver, max: number) => (await d.evaluate(scripts.snapshot(max))) as PageSnapshot;

/** Runs in the page; the selector arrives as an argument literal built by `call`, never spliced into source by hand. */
const countMatches = (selector: string): number => {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
};

/** Snapshots the page and resolves the locator to a ref (or a selector the page has). */
async function locate(d: BrowserDriver, target: ReplayLocator, fallbacks: readonly ReplayLocator[] = [], invoice?: ReplayOptions["invoice"], seen?: Seen): Promise<Resolution> {
  if (target.period && target.role) {
    if (!invoice) throw new Handoff("needs-invoice", "This step picks a period (month) by the invoice, and the job gave no invoice date.");
    const snap = await snapshotOf(d, RESOLVE_MAX_ELEMENTS);
    if (snap.omitted > 0) return { reason: "row-ambiguous", detail: `The page lists more controls than replay reads, so the period cannot be chosen; looking for ${describeInvoice(invoice)}.` };
    const labels = snap.elements.filter((e) => e.role === target.role && isPeriodLabel(e.name));
    const m = matchPeriod(labels.map((e, index) => ({ index, text: e.name })), invoice);
    if (m.kind === "one") return { target: labels[m.index]!.ref };
    return m.kind === "none" ? { reason: "row-not-found", detail: `No ${target.role} of ${labels.length} period labels covers ${describeInvoice(invoice)}.`, ...(labels.length ? {} : { empty: true as const }) } : { reason: "row-ambiguous", detail: `${m.candidates.length} period labels cover ${describeInvoice(invoice)}.` };
  }
  if (target.row) {
    if (!invoice) throw new Handoff("needs-invoice", "This step picks a row by the invoice, and the job gave no invoice date.");
    const snap = await snapshotOf(d, RESOLVE_MAX_ELEMENTS);
    if (snap.omitted > 0) return { reason: "row-ambiguous", detail: `The page lists more controls than replay reads, so the rows cannot be told apart; looking for ${describeInvoice(invoice)}.` };
    const refs = resolveAll(snap.elements, target, fallbacks);
    if (!refs.length) return { reason: "not-found", detail: `nothing on the page matches ${describeLocator(target)}` };
    const texts = (await d.evaluate(scripts.rowTexts(refs))) as (string | null)[];
    const picked = pickRow(refs, texts, invoice, target.row.match);
    // A row without any amount passes an amount rule, so only a row that shows the invoice's amount counts as compared.
    if (seen && "target" in picked && target.row.match.includes("amount") && invoice.amount !== undefined) {
      Object.assign(seen, picked.seen);
    }
    return picked;
  }
  const snap = await snapshotOf(d, RESOLVE_MAX_ELEMENTS);
  // Link addresses by ref, from the refs this snapshot just set, so identical links can be told apart.
  const hrefs = (await d.evaluate("Object.fromEntries([...(window.__pistaRefs ?? new Map())].map(([r, w]) => [r, w.deref()?.closest('a[href]')?.href ?? '']))").catch(() => ({}))) as Record<string, string>;
  const selectors = new Map<string, number>();
  for (const l of [target, ...fallbacks]) {
    if (l.selector) selectors.set(l.selector, Number(await d.evaluate(call(countMatches, l.selector)).catch(() => 0)));
  }
  return resolveLocator(snap.elements.map((e) => ({ ...e, href: hrefs?.[e.ref] || undefined })), target, fallbacks, selectors);
}

/** True once every set part of `expect` holds on the page. */
export async function expectationMet(d: BrowserDriver, expect: ReplayExpect): Promise<boolean> {
  if (expect.urlIncludes && !(await d.state()).url.includes(expect.urlIncludes)) return false;
  if (expect.text) {
    const body = String(await d.evaluate("document.body ? document.body.innerText : ''"));
    if (!norm(body).includes(norm(expect.text))) return false;
  }
  if (expect.element) {
    const r = await locate(d, expect.element);
    if (!("target" in r) && r.reason !== "ambiguous") return false; // waiting needs presence, not a unique match
  }
  return true;
}

/** Replays `playbook` from its start page. Never handles credentials: sign-in goes through the driver's saved-login fill. */
export async function runReplay(playbook: { startUrl: string; steps: readonly ReplayStep[]; shortcut?: { url: string; afterStep: number } }, o: ReplayOptions): Promise<ReplayResult> {
  const rules = o.domainRules;
  const d = rules && (rules.allowedDomains || rules.deniedDomains?.length) ? guardDriver(o.driver, rules, o.onDomainBlock) : o.driver;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const riskApprove: Approve = async (action) => {
    if (o.signal?.aborted) return "aborted";
    const yes = (await o.confirmRisk?.(action).catch(() => false)) === true;
    return o.signal?.aborted ? "aborted" : yes;
  };
  const steps: ReplayStep[] = [{ kind: "navigate", url: playbook.startUrl }, ...playbook.steps];
  const allowed = (url: string) => {
    try {
      if (!/^https?:$/.test(new URL(url).protocol)) return false;
    } catch {
      return false;
    }
    return o.allowUrl(url);
  };
  const guardUrl = (url: string, what: string) => {
    if (!allowed(url)) throw new Handoff("blocked", `${what} ${url.slice(0, BLOCKED_URL_MAX)} is outside this playbook's site or not an http(s) address.`);
  };
  const stillOnSite = async () => guardUrl((await d.state()).url, "The page moved to");
  let saved: { path: string; bytes: number; contentType?: string } | undefined;
  const verified: Verified = { date: false, amount: false };
  /** Records that the date was compared, and whether the amount was or only another currency was seen. */
  const noteAmount = (amount: boolean | undefined, foreign: boolean | undefined, how: Omit<Seen, "amount" | "foreign"> = {}) => {
    verified.date = true;
    if (how.matchedBy) verified.matchedBy = [...new Set([...(verified.matchedBy ?? []), ...how.matchedBy])];
    if (how.fxRateUsed !== undefined) verified.fxRateUsed = how.fxRateUsed;
    if (how.offsetDays !== undefined) verified.offsetDays = how.offsetDays;
    for (const k of ["rowAmount", "rowCurrency", "fxRateImplied"] as const) if (how[k] !== undefined) Object.assign(verified, { [k]: how[k] });
    if (amount) verified.amount = true;
    else if (foreign && !verified.amount) verified.foreignCurrency = true;
    if (verified.amount) delete verified.foreignCurrency;
  };
  /** Notes what a located step's row or period rule compared against the invoice. */
  const noteRule = (t: ReplayLocator, seen: Seen) => {
    if (!o.invoice || !(t.row || t.period)) return;
    noteAmount(seen.amount, seen.foreign, seen);
  };

  const click = async (target: string, what: string) => {
    const r = await runPageAction(d, { action: "click", target }, riskApprove, o.signal);
    if (r.note) throw new Handoff(o.signal?.aborted ? "aborted" : /^Stopped/.test(r.note) ? "declined" : "error", `${what}: ${r.note}`);
    return r;
  };
  /** Like `locate`, but a `not-found` (or a period step with no labels yet) is retried on a fresh snapshot for a few seconds: the page may still be building. */
  const locateWaiting = async (target: ReplayLocator, fallbacks?: readonly ReplayLocator[], seen?: Seen) => {
    const start = now();
    for (;;) {
      const r = await locate(d, target, fallbacks, o.invoice, seen);
      if ("target" in r || !(r.reason === "not-found" || (r.reason === "row-not-found" && r.empty)) || o.signal?.aborted || now() - start >= LOCATE_WAIT_MS) return r;
      await within(sleep(o.pollMs ?? LOCATE_POLL_MS), (o.pollMs ?? LOCATE_POLL_MS) + 1000, o.signal, () => undefined);
    }
  };
  /** Switches to the newest tab opened since `watch` was armed (or, without a watcher, since `known`); returns how many new tabs there were. */
  const adoptNewTab = async (watch: (() => Promise<{ id: string }[]>) | undefined, known: Set<string>) => {
    const fresh = watch ? await watch().catch(() => []) : ((await d.tabs?.().catch(() => undefined)) ?? []).filter((t) => !known.has(t.id));
    if (!fresh.length || !d.switchTab) return 0;
    await d.switchTab(fresh.at(-1)!.id);
    await settle(d);
    return fresh.length;
  };
  const notes: string[] = [];
  const run = async (step: ReplayStep, index: number) => {
    if (o.signal?.aborted) throw new Handoff("aborted", "The run was stopped.");
    if (step.kind !== "navigate" && step.kind !== "wait" && o.approve && !(await o.approve(step, index))) throw new Handoff("declined", "The user declined this step.");
    switch (step.kind) {
      case "navigate": {
        guardUrl(step.url, "The address");
        const opened = await d.navigate(step.url);
        if (opened.note) throw new Handoff("error", opened.note);
        await waitForLoad(d);
        await stillOnSite();
        await declineCookieBanner(d);
        break;
      }
      case "click": {
        const seen = { amount: false };
        const known = new Set(((await d.tabs?.().catch(() => undefined)) ?? []).map((t) => t.id));
        const watch = step.opensTab ? await d.watchNewTabs?.().catch(() => undefined) : undefined;
        const r = await locateWaiting(step.target, step.fallbacks, seen);
        if (!("target" in r)) throw new Handoff(r.reason, r.detail);
        noteRule(step.target, seen);
        let res = await click(r.target, "click");
        // The click should have opened a tab (the capture saw one). A tab can show up late, so look again before clicking a second time (a link only: a button may act twice).
        if (step.opensTab && (watch || d.tabs) && !res.openedTab) {
          const canRetry = !step.target.role || step.target.role === "link";
          for (let attempt = 0; ; attempt++) {
            if (!res.openedTab) await within(sleep(NEW_TAB_WAIT_MS), NEW_TAB_WAIT_MS + 1000, o.signal, () => undefined);
            const adopted = await adoptNewTab(watch, known);
            if (adopted > 1) notes.push(`step ${index}: ${adopted} new tabs were open after the click; the newest one was used.`);
            if (adopted || res.openedTab) break;
            if (!canRetry || attempt >= MAX_TAB_RETRIES) throw new Handoff("expectation-timeout", `expected a new tab after clicking ${describeLocator(step.target)}; none opened`);
            res = await click(r.target, "click");
          }
        }
        await stillOnSite();
        break;
      }
      case "signIn": {
        if (!d.loginList || !d.loginFill) throw new Handoff("sign-in-needed", "This browser has no saved logins.");
        const logins = (await d.loginList()).filter((l) => l.origin === step.origin);
        if (logins.length !== 1) throw new Handoff("sign-in-needed", logins.length ? `More than one saved login for ${step.origin}.` : `No saved login for ${step.origin}.`);
        let here = "";
        try {
          here = new URL((await d.state()).url).origin;
        } catch {}
        if (here !== step.origin) throw new Handoff("sign-in-needed", `The page is not on ${step.origin}.`);
        const filled = await d.loginFill(logins[0]!.id);
        if (!filled.ok) throw new Handoff("sign-in-needed", filled.note);
        await settle(d);
        await stillOnSite();
        break;
      }
      case "wait":
        break;
      case "download": {
        let source: { url: string } | { trigger: () => Promise<void> };
        if (step.url) {
          // An address cannot be tied to an invoice's row, so with an invoice it is never taken.
          if (o.invoice) throw new Handoff("row-not-verified", "This step downloads a fixed address, which can't be checked against the invoice's row.");
          source = { url: new URL(step.url, (await d.state()).url || undefined).href };
        } else if (step.target) {
          const seen = { amount: false };
          const r = await locateWaiting(step.target, [], seen);
          if (!("target" in r)) throw new Handoff(r.reason, r.detail);
          noteRule(step.target, seen);
          // A download found without a row rule must still sit in the invoice's row: a list showing one invoice is not proof it is the wanted one.
          if (o.invoice && !step.target.row && !step.target.period && step.verify === "page") {
            // A detail page: the invoice's date and amount are on the page itself, not in a row.
            const v = verifyPage(String(await d.evaluate("document.body ? document.body.innerText : ''").catch(() => "")).slice(0, PAGE_TEXT_MAX), o.invoice);
            if (!v.ok) throw new Handoff("ambiguous", `The ${step.target.name ? `'${step.target.name.slice(0, 60)}' ` : ""}${step.target.role ?? "element"}'s ${v.detail}.`);
            noteAmount(v.amount, v.amountVerified === false, v);
          } else if (o.invoice && !step.target.row && !step.target.period) {
            const v = verifySingleRow(await loneRowText(d, r.target), o.invoice);
            if (!v.ok) throw new Handoff("row-not-verified", `The ${step.target.name ? `'${step.target.name.slice(0, 60)}' ` : ""}${step.target.role ?? "element"}'s ${v.detail}.`);
            noteAmount(v.amount, v.amountVerified === false, v);
          }
          source = await refDownloadSource(d, r.target, riskApprove);
        } else throw new Handoff("error", "The download step has neither a url nor a target.");
        if ("url" in source) guardUrl(source.url, "The download address");
        let cancelled = false;
        const validate = (file: string, got: { contentType?: string; urlChain?: string[] }) => {
          if (cancelled) throw new Handoff("error", "The download finished after replay gave up on it.");
          // A click's file may come from a storage host after a redirect (an S3 bucket behind a "Download" button): the click already passed
          // the page guard, so each hop need only be https and clear the admin domain rules. A fixed address keeps the playbook's hosts.
          for (const u of got.urlChain ?? []) {
            if ("url" in source) guardUrl(u, "The download came from");
            else if (!/^https:\/\//i.test(u) || checkUrl(u, o.domainRules ?? {})) throw new Handoff("blocked", `The download came from ${u.slice(0, BLOCKED_URL_MAX)} is outside this playbook's site or not an http(s) address.`);
          }
          const reject = (why: string) => {
            throw new Handoff("error", `The downloaded file was not kept: ${why}.`);
          };
          // An empty or generic binary type says nothing: a PDF is then recognised by its first bytes.
          const ct = /^(application|binary)\/octet-stream\b/.test(got.contentType?.toLowerCase() ?? "") ? undefined : got.contentType?.toLowerCase() || undefined;
          const type = step.fileType?.toLowerCase();
          if (isWebPage(got.contentType, readHead(file))) reject("it is a web page");
          if (!type) return;
          if (ct) return void (!ct.includes(type) && reject(`expected ${type}, got ${ct}`));
          if (type !== "pdf" || !readFileSync(file).subarray(0, 5).toString("latin1").startsWith("%PDF-")) reject(`its type is unknown and it is not a ${type}`);
        };
        // A download still running at the deadline or a stop is discarded if it lands later: validate refuses it, so it never replaces the target.
        const got = await within(
          saveDownload(d, { root: o.downloadRoot, path: o.downloadPath, overwrite: o.overwrite, validate }, { ...source, ...(o.signal ? { signal: o.signal } : {}) }),
          o.downloadTimeoutMs ?? 60_000,
          o.signal,
          () => {
            throw new Handoff("error", "The download did not finish in time.");
          },
        ).catch((error) => {
          cancelled = true;
          throw error;
        });
        saved = { path: o.downloadPath, bytes: got.bytes, ...(got.contentType ? { contentType: got.contentType } : {}) };
        break;
      }
    }
    const expect = "expect" in step ? step.expect : undefined;
    if (expect && !(await pollUntil(() => expectationMet(d, expect), o.expectTimeoutMs ?? 10_000, o.pollMs ?? 250, now, sleep, o.signal))) {
      throw new Handoff("expectation-timeout", `Waited for ${[expect.urlIncludes && `the address to contain ${expect.urlIncludes}`, expect.text && `the text ${JSON.stringify(expect.text)}`, expect.element && describeLocator(expect.element)].filter(Boolean).join(" and ")}.`);
    }
  };

  const urls: string[] = [];
  let shortcut: ReplayShortcutOutcome | undefined;
  type Failure = Extract<ReplayResult, { ok: false }>;
  /** True on a sign-in page: a password field, or a sign-in looking address. The same wall the full path would stop at. */
  const loginWall = async (): Promise<boolean> => {
    try {
      if (/(^|[/_.-])(log-?in|sign-?in|sso|auth)($|[/_.-])/i.test(new URL((await d.state()).url).pathname)) return true;
      return d.probe ? (await d.probe()).secret : (await d.evaluate(scripts.hasPassword())) === true;
    } catch {
      return false;
    }
  };
  const walk = async (from: number): Promise<Failure | undefined> => {
    for (let i = from; i < steps.length; i++) {
      const step = steps[i]!;
      o.onStep?.(i, "start");
      try {
        await run(step, i);
      } catch (error) {
        o.onStep?.(i, "failed");
        const reason: ReplayReason = error instanceof Handoff ? error.reason : o.signal?.aborted ? "aborted" : error instanceof DomainBlockedError ? "blocked" : "error";
        const detail = (error instanceof Error ? error.message : String(error)).slice(0, DETAIL_MAX);
        // A page refused by the rules or off this playbook's site is not read into the handoff.
        const url = await d.state().then((st) => st.url, () => "");
        const snapshot = checkUrl(url, rules ?? {}) || !allowed(url) ? "" : await snapshotOf(d, 150).then((st) => formatSnapshot(st).slice(0, SNAPSHOT_MAX)).catch(() => "");
        return { ok: false, failedIndex: i, step, reason, detail, url: url.slice(0, URL_MAX), snapshot };
      }
      o.onStep?.(i, "done");
      urls[i] = (await d.state().then((st) => st.url, () => "")).slice(0, URL_MAX);
    }
    return undefined;
  };
  let from = 0;
  const sc = playbook.shortcut;
  const afterStep = sc && Number.isInteger(sc.afterStep) && sc.afterStep >= 1 && sc.afterStep < steps.length ? steps[sc.afterStep] : undefined;
  const expected = afterStep && "expect" in afterStep && afterStep.expect && (afterStep.expect.urlIncludes || afterStep.expect.text || afterStep.expect.element) ? afterStep.expect : undefined;
  // Only a shortcut whose landing page can be recognised is used. It opens like any navigation (same guards), must show what step `afterStep` expects, and must not be a sign-in page.
  if (sc && expected) {
    try {
      await run({ kind: "navigate", url: sc.url, expect: expected }, sc.afterStep);
      if (await loginWall()) throw new Handoff("sign-in-needed", "The shortcut page asks for a sign-in.");
      shortcut = "used";
      from = sc.afterStep + 1;
      for (let j = 0; j < from; j++) o.onStep?.(j, "done"); // the skipped steps count as done: the page is where they would have left it
      urls[sc.afterStep] = (await d.state()).url;
    } catch (error) {
      // A stop is reported by the walk below; any other problem means the full path runs instead.
      if (!o.signal?.aborted && !(error instanceof Handoff && error.reason === "aborted")) shortcut = "failed";
    }
  }
  let failure = await walk(from);
  if (failure && shortcut === "used" && failure.reason !== "aborted" && failure.reason !== "declined") {
    // The shortcut led somewhere the stored steps do not fit: once from the full path before handing off. If that works, the shortcut failed.
    shortcut = "failed";
    failure = await walk(0);
    if (failure) shortcut = undefined;
  }
  if (failure) return { ...failure, ...(shortcut ? { shortcut } : {}) };
  if (!saved) return { ok: false, failedIndex: steps.length - 1, step: steps[steps.length - 1]!, reason: "error", detail: "The playbook has no download step.", url: "", snapshot: "", ...(shortcut ? { shortcut } : {}) };
  return { ok: true, download: saved, steps: playbook.steps.length, urls: Array.from({ length: steps.length }, (_, i) => urls[i] ?? ""), verified, ...(notes.length ? { notes } : {}), ...(shortcut ? { shortcut } : {}) };
}
