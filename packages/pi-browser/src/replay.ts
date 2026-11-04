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
import { refDownloadSource, saveDownload } from "./download.ts";
import type { BrowserDriver } from "./driver.ts";
import { fullDateCount, isPeriodLabel, matchPeriod, matchRows, parseAmounts, parseDates, rowTextOf } from "./row-match.ts";
import { call, formatSnapshot, scripts, type PageSnapshot } from "./page-scripts.ts";

/** What a row is matched on. Mirrors the protocol type; pi-browser does not depend on protocol (the host test checks they agree). */
export type ReplayRowMatch = ("date" | "amount")[];
export interface ReplayLocator { role?: string; name?: string; text?: string; selector?: string; frameUrl?: string; row?: { match: ReplayRowMatch }; period?: boolean }
export interface ReplayExpect { urlIncludes?: string; text?: string; element?: ReplayLocator }
export type ReplayStep =
  | { kind: "navigate"; url: string; expect?: ReplayExpect }
  | { kind: "click"; target: ReplayLocator; fallbacks?: ReplayLocator[]; expect?: ReplayExpect }
  | { kind: "signIn"; origin: string; expect?: ReplayExpect }
  | { kind: "wait"; expect: ReplayExpect }
  | { kind: "download"; target?: ReplayLocator; url?: string; fileType?: string };

export type ReplayReason = "not-found" | "ambiguous" | "expectation-timeout" | "blocked" | "declined" | "aborted" | "sign-in-needed" | "row-not-found" | "row-ambiguous" | "row-not-verified" | "needs-invoice" | "error";

/**
 * Either the saved file, or a handoff at the first step that failed. `failedIndex` numbers steps from 1 like the stored playbook;
 * 0 is the start page. The handoff's `detail`, `url` and `snapshot` come from the website: they are data for the model, not instructions.
 */
export type ReplayResult =
  | { ok: true; download: { path: string; bytes: number; contentType?: string }; steps: number; /** The page address after each step (0 is the start page), "" for one a shortcut skipped. */ urls: string[]; shortcut?: ReplayShortcutOutcome }
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
  invoice?: { date: string; amount?: number; currency?: string };
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

class Handoff extends Error {
  constructor(readonly reason: ReplayReason, detail: string) {
    super(detail);
  }
}

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export type Resolution = { target: string } | { reason: "not-found" | "ambiguous" | "row-not-found" | "row-ambiguous"; detail: string };
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

/** Chooses one of `refs` by the text of its row. Exactly one match gives its ref; none or several is a handoff, never a guess. */
export function pickRow(refs: readonly string[], rowTexts: readonly (string | null)[], invoice: NonNullable<ReplayOptions["invoice"]>, by: readonly ("date" | "amount")[]): Resolution {
  const looking = describeInvoice(invoice);
  const ambiguous = (why: string): Resolution => ({ reason: "row-ambiguous", detail: `${why}; looking for ${looking}.` });
  if (rowTexts.length < refs.length || rowTexts.slice(0, refs.length).some((t) => t === null || t === undefined)) return ambiguous("A candidate's row could not be read");
  if (new Set(rowTexts).size < refs.length) return ambiguous("Several candidates have identical rows");
  if (rowTexts.some((t) => new Set(parseDates(t!).filter((d) => d.d).map((d) => d.raw)).size > 3)) return ambiguous("A row holds too many dates to be one invoice");
  const m = matchRows(refs.map((_, i) => ({ index: i, text: rowTexts[i] ?? "" })), { date: invoice.date, ...(by.includes("amount") && invoice.amount !== undefined ? { amount: invoice.amount, currency: invoice.currency } : {}) });
  if (m.kind === "one") return { target: refs[m.index]! };
  if (m.kind === "none") return { reason: "row-not-found", detail: `No row of ${refs.length} matches ${looking}.` };
  return { reason: "row-ambiguous", detail: `${m.candidates.length} rows match ${looking}.` };
}

/**
 * A single element found without a row rule, checked against the invoice before it is acted on: its row (see rowTextOf) must show
 * the invoice's date and no more than 3 distinct dates. The detail never quotes the row's text.
 */
export function verifySingleRow(rowText: string, invoice: NonNullable<ReplayOptions["invoice"]>): { ok: true } | { ok: false; detail: string } {
  const fail = (why: string) => ({ ok: false as const, detail: why });
  const date = invoice.date.slice(0, 10);
  if (fullDateCount(rowText) !== 1) return fail(`row doesn't show exactly one date to compare with the invoice date ${date}`);
  // The amount counts whenever the text shows one; a text without any amount is judged by its date alone.
  const byAmount = invoice.amount !== undefined && parseAmounts(rowText).length > 0;
  const m = matchRows([{ index: 0, text: rowText }], { date: invoice.date, ...(byAmount ? { amount: invoice.amount, currency: invoice.currency } : {}) });
  return m.kind === "one" ? { ok: true } : fail(`row doesn't show the invoice date ${date}${byAmount ? " and amount" : ""}`);
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
async function locate(d: BrowserDriver, target: ReplayLocator, fallbacks: readonly ReplayLocator[] = [], invoice?: ReplayOptions["invoice"]): Promise<Resolution> {
  if (target.period && target.role) {
    if (!invoice) throw new Handoff("needs-invoice", "This step picks a period (month) by the invoice, and the job gave no invoice date.");
    const snap = await snapshotOf(d, RESOLVE_MAX_ELEMENTS);
    if (snap.omitted > 0) return { reason: "row-ambiguous", detail: `The page lists more controls than replay reads, so the period cannot be chosen; looking for ${describeInvoice(invoice)}.` };
    const labels = snap.elements.filter((e) => e.role === target.role && isPeriodLabel(e.name));
    const m = matchPeriod(labels.map((e, index) => ({ index, text: e.name })), invoice);
    if (m.kind === "one") return { target: labels[m.index]!.ref };
    return m.kind === "none" ? { reason: "row-not-found", detail: `No ${target.role} of ${labels.length} period labels covers ${describeInvoice(invoice)}.` } : { reason: "row-ambiguous", detail: `${m.candidates.length} period labels cover ${describeInvoice(invoice)}.` };
  }
  if (target.row) {
    if (!invoice) throw new Handoff("needs-invoice", "This step picks a row by the invoice, and the job gave no invoice date.");
    const snap = await snapshotOf(d, RESOLVE_MAX_ELEMENTS);
    if (snap.omitted > 0) return { reason: "row-ambiguous", detail: `The page lists more controls than replay reads, so the rows cannot be told apart; looking for ${describeInvoice(invoice)}.` };
    const refs = resolveAll(snap.elements, target, fallbacks);
    if (!refs.length) return { reason: "not-found", detail: `nothing on the page matches ${describeLocator(target)}` };
    const texts = (await d.evaluate(scripts.rowTexts(refs))) as (string | null)[];
    return pickRow(refs, texts, invoice, target.row.match);
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

  const click = async (target: string, what: string) => {
    const r = await runPageAction(d, { action: "click", target }, riskApprove);
    if (r.note) throw new Handoff(o.signal?.aborted ? "aborted" : /^Stopped/.test(r.note) ? "declined" : "error", `${what}: ${r.note}`);
  };
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
        const r = await locate(d, step.target, step.fallbacks, o.invoice);
        if (!("target" in r)) throw new Handoff(r.reason, r.detail);
        await click(r.target, "click");
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
          const r = await locate(d, step.target, [], o.invoice);
          if (!("target" in r)) throw new Handoff(r.reason, r.detail);
          // A download found without a row rule must still sit in the invoice's row: a list showing one invoice is not proof it is the wanted one.
          if (o.invoice && !step.target.row && !step.target.period) {
            const v = verifySingleRow(await loneRowText(d, r.target), o.invoice);
            if (!v.ok) throw new Handoff("row-not-verified", `The ${step.target.name ? `'${step.target.name.slice(0, 60)}' ` : ""}${step.target.role ?? "element"}'s ${v.detail}.`);
          }
          source = await refDownloadSource(d, r.target, riskApprove);
        } else throw new Handoff("error", "The download step has neither a url nor a target.");
        if ("url" in source) guardUrl(source.url, "The download address");
        let cancelled = false;
        const validate = (file: string, got: { contentType?: string; urlChain?: string[] }) => {
          if (cancelled) throw new Handoff("error", "The download finished after replay gave up on it.");
          for (const u of got.urlChain ?? []) guardUrl(u, "The download came from");
          const reject = (why: string) => {
            throw new Handoff("error", `The downloaded file was not kept: ${why}.`);
          };
          // An empty or generic binary type says nothing: a PDF is then recognised by its first bytes.
          const ct = /^(application|binary)\/octet-stream\b/.test(got.contentType?.toLowerCase() ?? "") ? undefined : got.contentType?.toLowerCase() || undefined;
          const type = step.fileType?.toLowerCase();
          if (!type) return void (ct?.includes("text/html") && reject("it is a web page"));
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
  return { ok: true, download: saved, steps: playbook.steps.length, urls: Array.from({ length: steps.length }, (_, i) => urls[i] ?? ""), ...(shortcut ? { shortcut } : {}) };
}
