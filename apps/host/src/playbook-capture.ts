// Captures what the browser tools did in a thread and turns the model's chosen subset into a stored playbook.
// The model only picks entry numbers from what the host recorded, so it cannot invent URLs or selectors.
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { docKey, matchPeriod, pickRow, verifyPage, verifySingleRow, type BrowserTraceEntry, type TracePeriodContext, type TraceRowContext } from "@pista/pi-browser";
import { Type } from "typebox";
import { describeStep, type HostEvent, type Playbook, type PlaybookExpect, type PlaybookLocator, type PlaybookShortcut, type PlaybookStep } from "@pista/protocol";
import { merchantKeyword } from "./merchants.ts";
import { deriveShortcut, getPlaybook, addPendingMerchant, isOpaque, LABEL_MAX, MAX_TEXT, recordSuccess, savePlaybook, MAX_HOSTS, siteKey, trySiteKey, siteOf, isInternalHost, HISTORY, validatePlaybook, addSiteNote, notesBlock, NOTE_MAX, WHY_MAX } from "./playbooks.ts";

export const TRACE_LIMIT = 200;
/** A step a playbook run did before it handed off; saving after a repair keeps it as stored. */
export type ReplayedEntry = { kind: "replayed"; index: number; step: PlaybookStep };
export type TraceEntry = BrowserTraceEntry | ReplayedEntry;
export type TraceRow = { n: number } & TraceEntry;

/** The last TRACE_LIMIT successful browser actions of one thread, numbered from 1 (numbers never repeat). */
export class PlaybookTrace {
  /** The invoice this thread last worked on (from playbook_run, a first-pass handoff or playbook_save); lets the host capture a download by itself. */
  invoice?: unknown;
  merchant?: string;
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
        case "click": return `${r.n} click ${where(r.locator)}${place(r)} -> ${r.urlAfter}${r.openedTab ? " (opened a new tab)" : ""}`;
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

/** True for an address on a host that is not a vendor site (or no address at all); see isInternalHost. */
const isInternalUrl = (u?: string): boolean => {
  try {
    return !!u && isInternalHost(new URL(u).hostname);
  } catch {
    return true;
  }
};

const urlOf = (r: TraceRow): string | undefined => (r.kind === "navigate" ? r.url : r.kind === "click" ? r.urlAfter : r.kind === "download" ? r.url : r.kind === "signIn" ? r.origin : r.kind === "replayed" ? ("url" in r.step ? r.step.url : "origin" in r.step ? r.step.origin : undefined) : undefined);

/** Builds the playbook for the chosen entry numbers, or throws a short reason. Not yet validated; the caller runs validatePlaybook. */
export function playbookFromTrace(rows: readonly TraceRow[], chosen: number[], waitFor: Record<string, string> = {}, invoice?: InvoiceParams): { site: string; startUrl: string; steps: PlaybookStep[]; shortcut?: PlaybookShortcut; hosts: string[]; unverified?: boolean; verifiedBy?: "row" | "page" } {
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
  // Every domain the path visits (a vendor hands over to its payment page, say) is listed; replay stops on any other.
  const hosts = [site];
  for (const r of picked) {
    const u = urlOf(r);
    const h = trySiteKey(u);
    if (h && !hosts.includes(h)) hosts.push(h);
  }
  if (hosts.length > MAX_HOSTS) throw new Error(`the path visits ${hosts.length} different sites (${hosts.join(", ")}); at most ${MAX_HOSTS} are allowed, so record a shorter path`);
  // Text that looks like a token or hash is dropped, never stored.
  const clean = (v?: string) => (v && !isOpaque(v) ? v : undefined);
  // Once a step depends on the invoice, nothing after it may be a fixed address: those are specific to one invoice.
  let byInvoice = false;
  // A lone download whose row does not show the invoice: saved, but replay hands the step back every time.
  let unverified = false;
  let verifiedBy: "row" | "page" | undefined;
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
        return { kind: "click", target, ...(Object.keys(expect).length ? { expect } : {}), ...(r.openedTab ? { opensTab: true as const } : {}) };
      }
      case "download": {
        const fileType = r.contentType?.split(";")[0]?.split("/")[1];
        const row = r.rowContext ? rowRule(r.rowContext, invoice) : undefined;
        if (invoice && !r.locator?.role && !r.locator?.name && !r.locator?.text) throw new Error(`entry ${r.n}: this download has no button or link that can be found again (only an address or a selector), so its row can't be checked against the invoice; download it by clicking the invoice's button or link`);
        if (invoice && r.rowContext) verifiedBy = "row"; // with no row or page text there is nothing the replay can check
        // A detail page shows the invoice date and amount itself; then the page proves the download, not a row.
        if (invoice && r.rowContext?.texts.length === 1 && !verifySingleRow(r.rowContext.texts[0] ?? "", invoice).ok) {
          if (r.pageText && verifyPage(r.pageText, invoice).ok) verifiedBy = "page"; // also when the page shows another currency: date only
          else unverified = true;
        }
        if (row) byInvoice = true;
        if (byInvoice && !r.locator) throw new Error(`entry ${r.n}: this download address is specific to one invoice; download it by clicking`);
        const asClick = row || byInvoice || !!invoice;
        return { kind: "download", ...(!asClick && r.url ? { url: r.url } : { target: { ...r.locator, ...(row ? { row } : {}) } }), ...(fileType ? { fileType } : {}), ...(verifiedBy === "page" ? { verify: verifiedBy } : {}) }; // "row" is the default and not stored
      }
    }
  });
  const shortcut = deriveShortcut(first.url, steps, picked.slice(1).map((r) => (r.kind === "click" ? r.urlAfter : undefined)), hosts);
  return { site, hosts, startUrl: first.url, steps, ...(shortcut ? { shortcut } : {}), ...(unverified ? { unverified } : {}), ...(verifiedBy ? { verifiedBy } : {}) };
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
export function savePlaybookFromTrace(rows: readonly TraceRow[], chosen: number[], waitFor: Record<string, string> | undefined, threadId: string, invoice?: unknown, merchant?: unknown, unsure?: boolean, summary?: { created: string; updated: string }): { message: string; event?: HostEvent; /** One line for the host's own capture: what was saved. */ saved?: string; /** Why nothing was saved. */ reason?: string } {
  try {
    const { unverified, verifiedBy, ...built } = playbookFromTrace(rows, chosen, waitFor, invoice === undefined ? undefined : checkInvoice(invoice));
    const note = unverified ? " Saved. The last step will be handed back to you on each run, because the download's row doesn't show the invoice date." : verifiedBy ? ` The download is verified by ${verifiedBy === "page" ? "page" : "row"}.` : "";
    const old = getPlaybook(built.site);
    // Hosts the stored playbook already visits stay (site first, at most MAX_HOSTS), so a repair of one part does not drop the rest.
    const fresh = validatePlaybook({ ...built, hosts: [...new Set([...built.hosts, ...(old?.hosts ?? [])])].slice(0, MAX_HOSTS) }, built.site);
    const keyword = typeof merchant === "string" ? merchantKeyword(merchant) : undefined;
    // Keywords on file carry over; a new one is added (pending, with the reason when broad) once the playbook is saved.
    const carry = { ...(old?.merchants ? { merchants: old.merchants } : {}), ...(old?.merchantMisses ? { merchantMisses: old.merchantMisses } : {}), ...(old?.merchantLastMiss ? { merchantLastMiss: old.merchantLastMiss } : {}), ...(old?.merchantsPending ? { merchantsPending: old.merchantsPending } : {}), ...(old?.merchantsPendingWhy ? { merchantsPendingWhy: old.merchantsPendingWhy } : {}), notes: old?.notes ?? [], avoid: old?.avoid ?? [] };
    const learnKeyword = (): string => {
      if (!keyword || !addPendingMerchant(built.site, keyword, { unsure })) return "";
      const why = getPlaybook(built.site)?.merchantsPendingWhy?.[keyword];
      return ` Suggested the merchant keyword ${keyword}; ${why ? "it is broad, so the owner confirms it" : "a later verified download for a matching transaction confirms it"} before it is used.`;
    };
    const learned = fresh.shortcut ? [{ at: new Date().toISOString(), summary: HISTORY.shortcutLearned }] : [];
    const how = unverified ? `${fresh.steps.length} steps; the last is handed back each run` : `${fresh.steps.length} steps, ${verifiedBy ? `verified by ${verifiedBy}` : "unchecked"}`;
    const saved = `Saved a playbook for ${built.site} (${how}).`;
    if (!old || !old.steps.length) {
      // A notes-only playbook gets its first path here; its notes stay.
      savePlaybook({ ...fresh, ...carry, ...(old ? { createdAt: old.createdAt } : {}), history: [...learned, ...(summary ? [{ at: new Date().toISOString(), summary: summary.created }] : [])] });
      return { saved, message: `Saved a playbook for ${built.site} with ${fresh.steps.length} steps after the start page.${note}${learnKeyword()}`, event: { type: "playbook.event", threadId, kind: "learned", site: built.site, stepCount: fresh.steps.length } };
    }
    const max = Math.max(old.steps.length, fresh.steps.length);
    const changed = Array.from({ length: max }, (_, i) => i).filter((i) => !sameStep(old.steps[i], fresh.steps[i]));
    const startChanged = old.startUrl !== fresh.startUrl;
    if (!changed.length && !startChanged) {
      recordSuccess(built.site); // the same path just worked again
      return { saved: `The playbook for ${built.site} already matches this path.`, message: `The playbook for ${built.site} already matches this path; nothing changed.${note}${learnKeyword()}` };
    }
    const now = new Date().toISOString();
    savePlaybook({ ...fresh, ...carry, createdAt: old.createdAt, updatedAt: now, lastSucceeded: old.lastSucceeded, successCount: old.successCount, status: "ok", failCount: 0, history: [...old.history, ...learned, { at: now, summary: `${summary?.updated ?? `path re-recorded from entries ${chosen.join(",")}`}; ${startChanged ? "start URL changed" : `changed step${changed.length > 1 ? "s" : ""} ${changed.map((i) => i + 1).join(",")}`}` }] });
    const kwNote = learnKeyword();
    const first = startChanged ? 1 : changed[0]! + 1;
    const [before, after] = startChanged ? ["Open the start page", "Open a different start page"] : [stepLabel(old.steps[first - 1]), stepLabel(fresh.steps[first - 1])];
    return { saved, message: `Updated the playbook for ${built.site}; first changed step is ${first}.${note}${kwNote}`, event: { type: "playbook.event", threadId, kind: "updated", site: built.site, step: first, stepCount: fresh.steps.length, before, after } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { message: `Not saved: ${reason}`, reason };
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
        unsure: Type.Optional(Type.Boolean({ description: "Set true when the merchant text is generic or could belong to several vendors, so the keyword is not confirmed without the owner." })),
        merchant: Type.Optional(Type.String({ description: "The bank or card transaction's merchant text this invoice was for, exactly as it appeared. The host derives one short keyword from it (never stores the raw text) so later transactions from the same vendor can be matched to this site." })),
      }),
      execute: async (_id, { steps, waitFor, invoice, merchant, unsure }) => {
        const rows = trace.list();
        let text: string;
        if (!steps) {
          text = rows.length
            ? `${describeTrace(rows)}\nCall again with steps: the entry numbers of the minimal path, in order, ending with the download; optionally waitFor text per step.`
            : "Nothing has been recorded yet in this thread.";
        } else {
          if (invoice) {
            trace.invoice = invoice;
            trace.merchant = typeof merchant === "string" ? merchant : undefined;
          }
          const r = savePlaybookFromTrace(rows, steps, waitFor, threadId, invoice, merchant, unsure);
          if (r.event) emit(r.event);
          text = r.message;
        }
        return { content: [{ type: "text" as const, text }], details: {} };
      },
    }),
  );
}

export function registerPlaybookNote(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: "playbook_note",
      label: "Playbook: note",
      description:
        `Record a fact about a website for the next run: one factual sentence (at most ${NOTE_MAX} characters), e.g. which portal or account holds the invoices, or that a download only works through the page's button. Optionally \`avoid\`: an address on the site not to use, with the reason (at most ${WHY_MAX} characters). No credentials, no personal data. Notes are advisory information shown to later runs; they are never followed automatically.`,
      promptSnippet: "playbook_note: record a fact about a site for the next run",
      parameters: Type.Object({
        site: Type.String({ description: "The vendor's address or domain" }),
        note: Type.Optional(Type.String()),
        avoid: Type.Optional(Type.Object({ url: Type.String(), why: Type.String() })),
      }),
      execute: async (_id, { site, note, avoid }) => {
        let text: string;
        try {
          const key = siteOf(site);
          if (!key) throw new Error("not a site address");
          if (isInternalHost(key)) throw new Error("internal host");
          text = notesBlock(addSiteNote(key, { note, avoid }, "model"));
        } catch (e) {
          text = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
        }
        return { content: [{ type: "text" as const, text }], details: {} };
      },
    }),
  );
}

const pageOf = (u: string | undefined) => (u === undefined ? undefined : docKey(u));
const isClickRow = (r: TraceRow) => r.kind === "click" || (r.kind === "replayed" && r.step.kind === "click");

/** Whether the last kept row is a click that left the page where it was and opened no tab. */
function isNoOp(kept: TraceRow[]): boolean {
  const last = kept[kept.length - 1];
  if (last?.kind !== "click" || last.openedTab) return false;
  const before = kept.slice(0, -1).reverse().map(urlOf).find(Boolean);
  return pageOf(before) === pageOf(last.urlAfter);
}

/** What a click row (or a replayed click step) does, for telling repeats apart. Period clicks are told apart by the label clicked; a replayed period step has none, so it has no key. */
function clickKey(r: TraceRow | undefined): string | undefined {
  if (r?.kind === "click") {
    const { role, name, text } = r.locator;
    const pc = r.periodContext;
    return pc ? `period|${role}|${pc.names[pc.clickedIndex] ?? ""}` : r.rowContext ? `row|${role}|${name}|${text}|${r.rowContext.clickedIndex}` : `${role}|${name}|${text}`;
  }
  if (r?.kind === "replayed" && r.step.kind === "click") {
    const t = r.step.target;
    return t.period || t.row ? undefined : `${t.role}|${t.name}|${t.text}`;
  }
  return undefined;
}

/**
 * Takes dead ends out of a captured path: clicks between a page and the click that came back to it, and clicks on a different row of a list than the one the invoice names.
 * A click that changed nothing is folded into the next click when both are the same click, and a replayed step is folded into the model's immediately following click
 * when both are the same click. The one other drop of a replayed step: a replayed period step, a no-op re-click of a period link of the same role, then a period click that moved the page
 * to another address than the one before the replayed step (the replay's click had no effect, the model redid it); without that move (a client-side year, then month picker) all three stay. Everything else stays (a menu click changes no address; a year and then a month are two clicks). Sign-ins and the download are never dropped.
 */
function prune(path: TraceRow[], invoice: InvoiceParams): TraceRow[] {
  const kept: TraceRow[] = [];
  for (const x of path) {
    const key = clickKey(x);
    const prev = kept[kept.length - 1];
    if (key && prev && key === clickKey(prev) && (prev.kind === "replayed" || isNoOp(kept))) {
      const noop = prev.kind === "click";
      kept.pop();
      // The replay already followed the tab its click opened, so the model's re-click saw none; the kept click still opens one.
      const opens = prev.kind === "replayed" && prev.step.kind === "click" && prev.step.opensTab === true;
      // A period step the replay ran that changed nothing, then a no-op re-click, then the click that worked: one action.
      const before = kept[kept.length - 1];
      const pageBefore = kept.slice(0, -1).reverse().map(urlOf).find(Boolean);
      if (noop && x.kind === "click" && x.periodContext && before?.kind === "replayed" && before.step.kind === "click" && before.step.target.period && before.step.target.role === x.locator.role && pageOf(x.urlAfter) !== pageOf(pageBefore)) kept.pop();
      // A copy: the trace ring is not touched, and the unpruned fallback path keeps the original row.
      kept.push(opens && x.kind === "click" ? { ...x, openedTab: true } : x);
      continue;
    }
    if (x.kind === "click") {
      const at = kept.findIndex((e) => pageOf(urlOf(e)) === pageOf(x.urlAfter));
      const between = kept.slice(at + 1);
      // A loop needs a step away first: some row in between has another address. Clicks that never left the page (a menu, a tab, year then month) are not a loop.
      const cameBack = between.some((e) => { const u = urlOf(e); return u && pageOf(u) !== pageOf(x.urlAfter); });
      if (at >= 0 && between.length && cameBack && between.every(isClickRow)) {
        // Replayed steps worked, so they stay; only the model's own dead-end clicks go.
        const replayed = between.filter((e) => e.kind === "replayed");
        kept.length = at + 1;
        kept.push(...replayed);
        continue;
      }
    }
    kept.push(x);
  }
  const lastClick = kept.findLastIndex((x) => x.kind === "click");
  return kept.filter((x, i) => {
    if (x.kind !== "click" || !x.rowContext || i === lastClick) return true;
    try {
      rowRule(x.rowContext, invoice);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * The host's own capture after a successful browser_download: the shortest path to it from the last page opened by address on the download's site
 * (clicks, and a sign-in on the way), or, after a playbook handed off, the replayed steps plus what the model did. Returns a line for the model, or nothing
 * when it must stay silent (refused download, no invoice in context, an internal host, a sign-in somewhere off the path).
 */
export function autoCapture(trace: PlaybookTrace, resultText: string, threadId: string): { note?: string; event?: HostEvent } {
  let r: { path?: unknown; rejected?: unknown } = {};
  try {
    r = JSON.parse(resultText);
  } catch {}
  if (typeof r.path !== "string" || r.rejected) return {};
  let invoice: InvoiceParams;
  try {
    invoice = checkInvoice(trace.invoice);
  } catch {
    return {};
  }
  const fail = (reason: string) => ({ note: `Not captured automatically: ${reason}. Call playbook_save with the right steps if the path is reusable.` });
  const rows = trace.list();
  const dl = rows[rows.length - 1];
  if (dl?.kind !== "download" || dl.path !== r.path) return fail("the download left no recorded address or button");
  const before = rows.length > 1 ? urlOf(rows[rows.length - 2]!) : undefined;
  if (isInternalUrl(dl.url) || isInternalUrl(before)) return {};
  const hosts = [trySiteKey(dl.url), trySiteKey(before)].filter((h): h is string => !!h);
  // After a handoff: the replay's own start page, its replayed steps and everything the model did since.
  let start = -1;
  let k: number | undefined;
  const lastReplayed = rows.findLastIndex((x) => x.kind === "replayed");
  if (lastReplayed >= 0) {
    let i = lastReplayed;
    while (i > 0 && rows[i - 1]!.kind === "replayed") i--;
    const nav = rows[i - 1];
    // The replayed steps already stayed on the playbook's own hosts, so the start page may be on another site than the download.
    if (nav?.kind === "navigate") {
      start = i - 1;
      k = Math.max(...rows.filter((x): x is TraceRow & ReplayedEntry => x.kind === "replayed").map((x) => x.index)) + 1;
    }
  }
  // A path may cross sites through clicks (a link that opens a tab): the start is the page the unbroken run of clicks began from, on any host.
  if (start < 0) {
    let i = rows.length - 2;
    while (i >= 0 && rows[i]!.kind === "click") i--;
    if (i >= 0 && rows[i]!.kind === "navigate") start = i;
  }
  const known = hosts.map((h) => getPlaybook(h)).find(Boolean);
  const startHosts = [...hosts, ...(known?.hosts ?? [])];
  if (start < 0) start = rows.findLastIndex((x) => x.kind === "navigate" && startHosts.includes(trySiteKey(x.url) ?? ""));
  if (start < 0) return fail("no page opened by address on this site is in the recorded trace");
  const path = rows.slice(start);
  const onPath = new Set(path.map((x) => trySiteKey(urlOf(x))).filter(Boolean));
  if (rows.some((x) => x.kind === "signIn" && !onPath.has(trySiteKey(x.origin) ?? ""))) return {};
  const summary = { created: HISTORY.captured, updated: k !== undefined ? HISTORY.repaired(k) : HISTORY.captured };
  const save = (entries: TraceRow[]) => savePlaybookFromTrace(rows.map((r) => entries.find((e) => e.n === r.n) ?? r), entries.map((x) => x.n), undefined, threadId, invoice, trace.merchant, undefined, summary);
  // Dead ends are pruned first; if that path cannot be saved, the full one gets one try.
  const pruned = prune(path, invoice);
  let res = save(pruned);
  if (!res.saved && pruned.length !== path.length) res = save(path);
  if (res.saved) {
    trace.invoice = undefined;
    trace.merchant = undefined;
  }
  return { ...(res.saved ? { note: res.saved } : fail(res.reason ?? "it could not be saved")), ...(res.event ? { event: res.event } : {}) };
}
