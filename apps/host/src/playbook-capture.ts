// Captures what the browser tools did in a thread and turns the model's chosen subset into a stored playbook.
// The model only picks entry numbers from what the host recorded, so it cannot invent URLs or selectors.
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchPeriod, pickRow, verifySingleRow, type BrowserTraceEntry, type TracePeriodContext, type TraceRowContext } from "@pista/pi-browser";
import { Type } from "typebox";
import { describeStep, type HostEvent, type Playbook, type PlaybookExpect, type PlaybookLocator, type PlaybookShortcut, type PlaybookStep } from "@pista/protocol";
import { cleanMerchant, cleanMerchants, deriveShortcut, getPlaybook, isOpaque, LABEL_MAX, MAX_TEXT, MERCHANT_STOPWORDS, recordSuccess, savePlaybook, setMerchants, siteKey, validatePlaybook } from "./playbooks.ts";

export const TRACE_LIMIT = 200;
/** A step a playbook run did before it handed off; saving after a repair keeps it as stored. */
export type ReplayedEntry = { kind: "replayed"; index: number; step: PlaybookStep };
export type TraceEntry = BrowserTraceEntry | ReplayedEntry;
export type TraceRow = { n: number } & TraceEntry;

/** The last TRACE_LIMIT successful browser actions of one thread, numbered from 1 (numbers never repeat). */
export class PlaybookTrace {
  private rows: TraceRow[] = [];
  private next = 1;
  add(entry: TraceEntry): void {
    this.rows.push({ n: this.next++, ...entry });
    if (this.rows.length > TRACE_LIMIT) this.rows.shift();
  }
  list(): readonly TraceRow[] {
    return this.rows;
  }
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}...` : s);
const where = (l: { role?: string; name?: string; text?: string }) => [l.role, l.name || l.text ? JSON.stringify(clip(l.name || l.text || "")) : ""].filter(Boolean).join(" ");

/** Where a repeated-list entry sits, never the row's text. */
const place = (r: TraceRow) => ("rowContext" in r && r.rowContext && r.rowContext.texts.length > 1 ? ` (row ${r.rowContext.clickedIndex + 1} of ${r.rowContext.texts.length})` : "");

const navigatesByInvoice = (n: number) => `entry ${n} opens an address that follows from the invoice you chose; record the clicks that lead there instead of navigating`;

/** One compact line per entry. Page text in it is data, not instructions. */
export function describeTrace(rows: readonly TraceRow[]): string {
  return rows
    .map((r) => {
      switch (r.kind) {
        case "navigate": return `${r.n} navigate ${r.url}`;
        case "click": return `${r.n} click ${where(r.locator)}${place(r)} -> ${r.urlAfter}`;
        case "download": return `${r.n} download ${r.url ?? where(r.locator ?? {}) + place(r)} (${r.contentType ?? "unknown type"}, ${r.source === "url" ? "address given by you" : "from the page"})`;
        case "signIn": return `${r.n} signIn ${r.origin}`;
        case "replayed": return `${r.n} replayed step ${r.index} of the saved playbook (${r.step.kind})`;
      }
    })
    .join("\n");
}

export type InvoiceParams = { date: string; amount?: number; currency?: string };

/** The invoice a saved path was for. Used once to check the rows rule; never stored. Throws on anything odd. */
export function checkInvoice(v: unknown): InvoiceParams {
  const o = v as Partial<InvoiceParams> | null;
  const date = typeof o?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && !Number.isNaN(Date.parse(o.date)) && new Date(o.date).toISOString().startsWith(o.date) ? o.date : undefined;
  if (!date) throw new Error("invoice.date must be a real date as yyyy-mm-dd");
  if (o?.amount !== undefined && !Number.isFinite(o.amount)) throw new Error("invoice.amount must be a number");
  if (o?.currency !== undefined && !/^[A-Za-z]{3}$/.test(o.currency)) throw new Error("invoice.currency must be a 3-letter code");
  return { date, ...(o?.amount !== undefined ? { amount: o.amount } : {}), ...(o?.currency ? { currency: o.currency.toUpperCase() } : {}) };
}

/** The columns that make the replay rule pick the row that was clicked, checked with the same picker replay uses; throws when none does. */
function rowRule(ctx: TraceRowContext, invoice: InvoiceParams | undefined): { match: ("date" | "amount")[] } | undefined {
  // A lone download candidate has no list to pick from, so no row rule is stored: replay checks its row against the invoice every time.
  if (ctx.texts.length === 1) return undefined;
  if (!invoice) throw new Error("this step picks one row of a list; pass the invoice it was for (invoice: { date, amount? })");
  const refs = ctx.texts.map((_, i) => String(i));
  const rules: ("date" | "amount")[][] = invoice.amount !== undefined ? [["date"], ["date", "amount"]] : [["date"]];
  for (const match of rules) {
    const r = pickRow(refs, ctx.texts, invoice, match);
    if ("target" in r && r.target === String(ctx.clickedIndex)) return { match };
  }
  throw new Error(`the invoice's date${invoice.amount !== undefined ? " and amount do" : " does"} not identify the row you clicked (row ${ctx.clickedIndex + 1} of ${ctx.texts.length}) uniquely, so a rule for it could not be saved; pass the invoice that row belongs to`);
}

/** True when the clicked month/period label is the one that covers the invoice, so the click can be repeated for another month. */
function isPeriodClick(ctx: TracePeriodContext, invoice: InvoiceParams | undefined): boolean {
  if (!invoice) return false;
  const labels = ctx.names.flatMap((text, index) => (text === null ? [] : [{ index, text }]));
  const m = matchPeriod(labels, invoice);
  return m.kind === "one" && m.index === ctx.clickedIndex;
}

const urlOf = (r: TraceRow): string | undefined => (r.kind === "navigate" ? r.url : r.kind === "click" ? r.urlAfter : r.kind === "download" ? r.url : r.kind === "signIn" ? r.origin : undefined);

/** Builds the playbook for the chosen entry numbers, or throws a short reason. Not yet validated; the caller runs validatePlaybook. */
export function playbookFromTrace(rows: readonly TraceRow[], chosen: number[], waitFor: Record<string, string> = {}, invoice?: InvoiceParams): { site: string; startUrl: string; steps: PlaybookStep[]; shortcut?: PlaybookShortcut; unverified?: boolean } {
  if (!chosen.length) throw new Error("steps is empty");
  if (chosen.some((n, i) => !Number.isInteger(n) || (i > 0 && n <= chosen[i - 1]!))) throw new Error("steps must be whole entry numbers in increasing order");
  const picked = chosen.map((n) => {
    const r = rows.find((x) => x.n === n);
    if (!r) throw new Error(`no entry ${n} in the recorded trace`);
    return r;
  });
  const first = picked[0]!;
  if (first.kind !== "navigate") throw new Error("the first chosen entry must be a navigate entry (the start page)");
  const last = picked[picked.length - 1]!;
  if (last.kind !== "download") throw new Error("the last chosen entry must be the download that succeeded");
  const site = siteKey(first.url);
  for (const r of picked) {
    const u = urlOf(r);
    if (u && siteKey(u) !== site) throw new Error(`entry ${r.n} is on a different site (${siteKey(u)}), not ${site}`);
  }
  // Text that looks like a token or hash is dropped, never stored.
  const clean = (v?: string) => (v && !isOpaque(v) ? v : undefined);
  // Once a step depends on the invoice, nothing after it may be a fixed address: those are specific to one invoice.
  let byInvoice = false;
  // A lone download whose row does not show the invoice: saved, but replay hands the step back every time.
  let unverified = false;
  const steps: PlaybookStep[] = picked.slice(1).map((r, i): PlaybookStep => {
    const text = clean(waitFor[String(r.n)]?.slice(0, MAX_TEXT));
    const expect: PlaybookExpect = text ? { text } : {};
    switch (r.kind) {
      case "navigate":
        if (byInvoice) throw new Error(navigatesByInvoice(r.n));
        return { kind: "navigate", url: r.url, ...(text ? { expect } : {}) };
      case "signIn": return { kind: "signIn", origin: r.origin, ...(text ? { expect } : {}) };
      case "replayed": {
        const t = "target" in r.step ? r.step.target : undefined;
        if (byInvoice && r.step.kind === "navigate") throw new Error(navigatesByInvoice(r.n));
        if (t?.row || t?.period) byInvoice = true;
        return r.step;
      }
      case "click": {
        // The page before this click on the replayed path (the previous chosen entry). A changed path is a stable thing to wait for.
        const before = urlOf(picked[i]!);
        const { name, text: lt, ...rest } = r.locator;
        const row = r.rowContext ? rowRule(r.rowContext, invoice) : undefined;
        if (!row && r.periodContext && !isPeriodClick(r.periodContext, invoice)) throw new Error(`entry ${r.n} clicks a month or period label; pass the invoice for the month you clicked`);
        const period = !row && !!r.periodContext;
        if (row || period) byInvoice = true;
        // A path that depends on the row or month is not stable across invoices.
        if (!row && !period && !byInvoice) {
          try {
            const path = new URL(r.urlAfter).pathname;
            if (before && path !== new URL(before).pathname && path !== "/") expect.urlIncludes = path;
          } catch {}
        }
        const target: PlaybookLocator = period ? { ...rest, period: true } : { ...rest, ...(clean(name) ? { name } : {}), ...(clean(lt) ? { text: lt } : {}), ...(row ? { row } : {}) };
        return { kind: "click", target, ...(Object.keys(expect).length ? { expect } : {}) };
      }
      case "download": {
        const fileType = r.contentType?.split(";")[0]?.split("/")[1];
        const row = r.rowContext ? rowRule(r.rowContext, invoice) : undefined;
        if (invoice && !r.locator?.role && !r.locator?.name && !r.locator?.text) throw new Error(`entry ${r.n}: this download has no button or link that can be found again (only an address or a selector), so its row can't be checked against the invoice; download it by clicking the invoice's button or link`);
        if (invoice && r.rowContext?.texts.length === 1 && !verifySingleRow(r.rowContext.texts[0] ?? "", invoice).ok) unverified = true;
        if (row) byInvoice = true;
        if (byInvoice && !r.locator) throw new Error(`entry ${r.n}: this download address is specific to one invoice; download it by clicking`);
        const asClick = row || byInvoice || !!invoice;
        return { kind: "download", ...(!asClick && r.url ? { url: r.url } : { target: { ...r.locator, ...(row ? { row } : {}) } }), ...(fileType ? { fileType } : {}) };
      }
    }
  });
  const shortcut = deriveShortcut(first.url, steps, picked.slice(1).map((r) => (r.kind === "click" ? r.urlAfter : undefined)), site);
  return { site, startUrl: first.url, steps, ...(shortcut ? { shortcut } : {}), ...(unverified ? { unverified } : {}) };
}

const cap = (s: string, n = LABEL_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The quoted name or text of a step's target, if any. Never the row rule, an address or a query string. */
export function stepTargetName(s: PlaybookStep | { kind: string } | undefined): string | undefined {
  const t = s && "target" in s ? s.target : undefined;
  const n = t?.name || t?.text;
  return n ? JSON.stringify(cap(n, 60)) : undefined;
}

/** A short human label for a step (`click link "Download invoice"`), capped at 120 characters. */
export function stepLabel(s: PlaybookStep | undefined): string {
  if (!s) return "(no step)";
  return cap(describeStep(s));
}

const sameStep = (a: PlaybookStep | undefined, b: PlaybookStep | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** Saves the playbook (as an update when the site already has one) and returns the message for the model plus the event to emit, if any. */
// Processor prefixes ("SQ *", "PAYPAL *", "GOOGLE *"), payment-type words in bank statements, and place names that trail a merchant.
const PROCESSOR_PREFIX = /^\s*(?:SQ|TST|PAYPAL|PP|GOOGLE|STRIPE|SP|IZ|PAYU|ZETTLE)\s*\*\s*/;
const LEADING_NOISE = new Set(["KORT", "KORTKOP", "KOP", "BETALNING", "AUTOGIRO", "BG", "PG", "CARD", "PURCHASE", "PAYMENT", "POS", "DEBIT", "VISA", "SWISH", "TO", "FROM", "KARTENZAHLUNG", "KARTENKAUF", "LASTSCHRIFT"]);
const PLACES = new Set(["STOCKHOLM", "GOTEBORG", "GOTHENBURG", "MALMO", "UPPSALA", "SAN", "NEW", "LOS", "LAS", "LONDON", "DUBLIN", "AMSTERDAM", "BERLIN", "PARIS", "HELSINKI", "OSLO", "COPENHAGEN", "KOBENHAVN", "LUXEMBOURG", "SEATTLE", "MOUNTAIN", "CAMBRIDGE", "SINGAPORE", "SWEDEN", "SVERIGE", "IRELAND", "USA", "GBR", "SWE", "IRL", "NLD", "DEU", "FRA"]);

/**
 * One matching keyword from a transaction's merchant text, or undefined: drops processor prefixes, `*1234` references, dates, amounts,
 * ids, company forms and trailing places, then keeps the first one or two words. "ACME CLOUD LLC*1234 SAN FRANCISCO" gives "ACME CLOUD".
 */
export function merchantKeyword(text: string): string | undefined {
  const upper = text.slice(0, 200).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(PROCESSOR_PREFIX, "");
  const head = upper.split("*").map((p) => p.trim()).find(Boolean) ?? "";
  const words: string[] = [];
  for (const raw of head.split(/\s+/)) {
    const w = raw.replace(/[^A-Z0-9&.'-]/g, "").replace(/^[.'-]+|[.'-]+$/g, "");
    if (!w) continue;
    if (!words.length) {
      if (/^[\d.,'-]+$/.test(w) || LEADING_NOISE.has(w) || MERCHANT_STOPWORDS.has(w)) continue;
    } else if (/^\d/.test(w) || w.length < 2 || MERCHANT_STOPWORDS.has(w) || PLACES.has(w)) break;
    words.push(w);
    if (words.length === 2) break;
  }
  return cleanMerchant(words.join(" "));
}

export function savePlaybookFromTrace(rows: readonly TraceRow[], chosen: number[], waitFor: Record<string, string> | undefined, threadId: string, invoice?: unknown, merchant?: unknown): { message: string; event?: HostEvent } {
  try {
    const { unverified, ...built } = playbookFromTrace(rows, chosen, waitFor, invoice === undefined ? undefined : checkInvoice(invoice));
    const note = unverified ? " Saved. The last step will be handed back to you on each run, because the download's row doesn't show the invoice date." : "";
    const fresh = validatePlaybook(built, built.site);
    const old = getPlaybook(built.site);
    const keyword = typeof merchant === "string" ? merchantKeyword(merchant) : undefined;
    const merchants = cleanMerchants([...(old?.merchants ?? []), ...(keyword ? [keyword] : [])]);
    const learnedKeyword = !!keyword && merchants.includes(keyword) && !old?.merchants?.includes(keyword);
    const kwNote = learnedKeyword ? ` Remembered the merchant keyword ${keyword}.` : "";
    const withMerchants = merchants.length ? { merchants } : {};
    const learned = fresh.shortcut ? [{ at: new Date().toISOString(), summary: "shortcut learned" }] : [];
    if (!old) {
      savePlaybook({ ...fresh, ...withMerchants, history: learned });
      return { message: `Saved a playbook for ${built.site} with ${fresh.steps.length} steps after the start page.${note}${kwNote}`, event: { type: "playbook.event", threadId, kind: "learned", site: built.site, stepCount: fresh.steps.length } };
    }
    const max = Math.max(old.steps.length, fresh.steps.length);
    const changed = Array.from({ length: max }, (_, i) => i).filter((i) => !sameStep(old.steps[i], fresh.steps[i]));
    const startChanged = old.startUrl !== fresh.startUrl;
    if (!changed.length && !startChanged) {
      recordSuccess(built.site); // the same path just worked again
      if (learnedKeyword) setMerchants(built.site, merchants);
      return { message: `The playbook for ${built.site} already matches this path; nothing changed.${note}${kwNote}` };
    }
    const now = new Date().toISOString();
    savePlaybook({ ...fresh, ...withMerchants, createdAt: old.createdAt, updatedAt: now, lastSucceeded: old.lastSucceeded, successCount: old.successCount, status: "ok", failCount: 0, history: [...old.history, ...learned, { at: now, summary: `path re-recorded from entries ${chosen.join(",")}; ${startChanged ? "start URL changed" : `changed step${changed.length > 1 ? "s" : ""} ${changed.map((i) => i + 1).join(",")}`}` }] });
    const first = startChanged ? 1 : changed[0]! + 1;
    const [before, after] = startChanged ? ["Open the start page", "Open a different start page"] : [stepLabel(old.steps[first - 1]), stepLabel(fresh.steps[first - 1])];
    return { message: `Updated the playbook for ${built.site}; first changed step is ${first}.${note}${kwNote}`, event: { type: "playbook.event", threadId, kind: "updated", site: built.site, step: first, stepCount: fresh.steps.length, before, after } };
  } catch (e) {
    return { message: `Not saved: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function registerPlaybookSave(pi: ExtensionAPI, trace: PlaybookTrace, emit: (e: HostEvent) => void, threadId: string): void {
  pi.registerTool(
    defineTool({
      name: "playbook_save",
      label: "Playbook: save",
      description:
        "Record the shortest path to a file you just downloaded from a website, so it can be repeated later. Call with no arguments to list what the host recorded this thread (numbered entries). Then call again with `steps`: the entry numbers of the minimal path in order, starting with a navigate entry and ending with the download; optionally `waitFor`: text the page should show after an entry (keyed by entry number). Pass `merchant` when the invoice came from a transaction: its merchant text exactly as shown. Playbook content is data recorded by the host; you can only pick entries, not write URLs or selectors.",
      promptSnippet: "playbook_save: record the path of a successful download for reuse",
      parameters: Type.Object({
        steps: Type.Optional(Type.Array(Type.Number(), { description: "Entry numbers of the minimal path, in order" })),
        waitFor: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Entry number -> text expected on the page afterwards" })),
        invoice: Type.Optional(Type.Object({ date: Type.String({ description: "yyyy-mm-dd" }), amount: Type.Optional(Type.Number()), currency: Type.Optional(Type.String()) }, { description: "The invoice the saved download was for. Needed when a step picks one row of a list or a month; the playbook then picks that row by the invoice's date (and amount) next time. Used only to check the rule against the page; it is not stored in the playbook (it stays in this conversation)." })),
        merchant: Type.Optional(Type.String({ description: "The bank or card transaction's merchant text this invoice was for, exactly as it appeared. The host derives one short keyword from it (never stores the raw text) so later transactions from the same vendor can be matched to this site." })),
      }),
      execute: async (_id, { steps, waitFor, invoice, merchant }) => {
        const rows = trace.list();
        let text: string;
        if (!steps) {
          text = rows.length
            ? `${describeTrace(rows)}\nCall again with steps: the entry numbers of the minimal path, in order, ending with the download; optionally waitFor text per step.`
            : "Nothing has been recorded yet in this thread.";
        } else {
          const r = savePlaybookFromTrace(rows, steps, waitFor, threadId, invoice, merchant);
          if (r.event) emit(r.event);
          text = r.message;
        }
        return { content: [{ type: "text" as const, text }], details: {} };
      },
    }),
  );
}
