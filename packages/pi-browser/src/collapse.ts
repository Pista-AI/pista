/**
 * Stage 1 of the context rewriter (see context.ts): on every request, older page views are collapsed to one line each, so the
 * prompt stays roughly flat instead of growing with every page the agent looks at.
 *
 * Page views are grouped by document (the URL without its #fragment). The newest view is always kept in full, and so is
 * the full view a delta result builds on (with any deltas in between: each is relative to the one before it). Per document
 * the latest view is kept while the document is current or was left at most `staleDocumentTurns` assistant turns ago; after
 * that the whole document collapses. Collapsing is sticky by tool-call id, so the model's view of history only ever shrinks
 * and the prompt prefix before a collapsed result stays byte-identical on later requests.
 *
 * Pure: it only shapes the outgoing request, the session file keeps the full results.
 */

/**
 * Tool results that carry a view of the page rather than an answer the agent asked for. Exported so other context
 * rewriters (the host's tool-result pruner) leave these to this module and the prompt prefix stays stable.
 */
export const PAGE_VIEW_TOOLS: ReadonlySet<string> = new Set([
  "browser_snapshot",
  "browser_read",
  "browser_screenshot",
  "browser_click",
  "browser_type",
  "browser_fill",
  "browser_choose",
  "browser_select",
  "browser_press",
  "browser_scroll",
  "browser_back",
]);

export const DEFAULT_STALE_DOCUMENT_TURNS = 1;
/** A collapsed line is cut to about this many characters. */
const MAX_LINE = 300;
const MAX_TITLE = 60;
const MAX_NAME = 40;
export const COLLAPSED_PREFIX = "[earlier ";

export type Part = { type: string; text?: string };
export type ToolResultLike = { role: "toolResult"; toolName: string; toolCallId?: string; isError?: boolean; content: Part[] };

export const isPageView = (m: unknown): m is ToolResultLike => {
  const msg = m as Partial<ToolResultLike>;
  return msg.role === "toolResult" && typeof msg.toolName === "string" && PAGE_VIEW_TOOLS.has(msg.toolName) && Array.isArray(msg.content);
};

/** True for a result that stage 1 already reduced to its one-line form. */
export const isCollapsed = (m: ToolResultLike): boolean => m.content.length === 1 && !!m.content[0]?.text?.startsWith(COLLAPSED_PREFIX);

export interface CollapseState {
  /** Tool-call ids already collapsed; they stay collapsed in every later request. */
  collapsed: Set<string>;
}
export interface CollapseOptions {
  /** Assistant turns a document stays in full after the model left it. Default 1 (PI_BROWSER_STALE_DOC_TURNS). */
  staleDocumentTurns?: number;
  /** Ids the budget stage already stubbed: they stay stubs and are never rewritten to the collapse line. */
  stubbed?: ReadonlySet<string>;
}
export interface CollapseResult<T> {
  messages: T[];
  /** Ids collapsed by this call and not by an earlier one. */
  newlyCollapsed: string[];
  /** Ids of the newest view and the earlier views a delta result needs to be read (its baseline chain). */
  newestChain: ReadonlySet<string>;
}

/** Turns from an env-style value: a whole number >= 0, else undefined. */
export function parseStaleDocumentTurns(value: string | undefined): number | undefined {
  const n = Number(value);
  return value?.trim() && Number.isInteger(n) && n >= 0 ? n : undefined;
}

// ---- Reading the history ----

interface Call {
  index: number;
  name: string;
  args: Record<string, unknown>;
}
interface Entry {
  index: number;
  msg: ToolResultLike;
  id?: string;
  error: boolean;
  url: string;
  doc: string;
  title: string;
  body: string;
  delta: boolean;
  elements?: number;
}
interface History {
  entries: Entry[];
  calls: Call[];
  assistants: number[];
  /** Page views (not errors) and navigations, oldest first: where the model was looking. */
  events: { index: number; doc: string }[];
}

const textOf = (m: ToolResultLike) => m.content.filter((p) => p.type === "text").map((p) => p.text ?? "");
const docKey = (url: string) => url.split("#")[0]!;
const isDeltaBody = (body: string) => body.startsWith("Page changed (delta") || body.startsWith("No interactive elements or visible text changed");

function parseMeta(first: string | undefined): { url: string; title: string } {
  try {
    const meta = JSON.parse(first ?? "") as { url?: unknown; title?: unknown };
    return { url: typeof meta.url === "string" ? meta.url : "", title: typeof meta.title === "string" ? meta.title : "" };
  } catch {
    return { url: "", title: "" };
  }
}

function readHistory(messages: unknown[]): History {
  const h: History = { entries: [], calls: [], assistants: [], events: [] };
  const argsById = new Map<string, Record<string, unknown>>();
  messages.forEach((m, index) => {
    const msg = m as { role?: string; content?: unknown; toolName?: string; toolCallId?: string; isError?: boolean };
    if (msg.role === "assistant") {
      h.assistants.push(index);
      if (!Array.isArray(msg.content)) return;
      for (const p of msg.content as { type?: string; id?: string; name?: string; arguments?: unknown }[]) {
        if (p.type !== "toolCall" || typeof p.name !== "string") continue;
        const args = p.arguments && typeof p.arguments === "object" ? (p.arguments as Record<string, unknown>) : {};
        h.calls.push({ index, name: p.name, args });
        if (p.id) argsById.set(p.id, args);
      }
    } else if (isPageView(m)) {
      const [first, ...rest] = textOf(m);
      const { url, title } = parseMeta(first);
      const body = rest.join("\n");
      const count = /^(\d+) interactive elements/.exec(body);
      const entry: Entry = {
        index,
        msg: m,
        id: m.toolCallId || undefined,
        error: m.isError === true,
        url,
        doc: docKey(url),
        title,
        body,
        delta: isDeltaBody(body),
        ...(count ? { elements: Number(count[1]) } : {}),
      };
      h.entries.push(entry);
      if (!entry.error) h.events.push({ index, doc: entry.doc });
    } else if (msg.role === "toolResult" && msg.toolName === "browser_navigate" && !msg.isError) {
      // Navigations are not page views (their result is meta only) but they move the model to another document.
      const [first] = textOf(msg as ToolResultLike);
      const url = parseMeta(first).url || String(argsById.get(msg.toolCallId ?? "")?.url ?? "");
      if (url) h.events.push({ index, doc: docKey(url) });
    }
  });
  return h;
}

// ---- Which views stay in full ----

/** `at` plus, when it is a delta, the views it can only be read against: earlier snapshots of the document back to a full one. */
function chainOf(views: Entry[], at: number): Entry[] {
  const chain = [views[at]!];
  if (!views[at]!.delta) return chain;
  for (let i = at - 1; i >= 0; i--) {
    const v = views[i]!;
    if (v.doc !== views[at]!.doc) continue;
    if (v.delta) chain.push(v);
    else if (v.elements !== undefined) {
      chain.push(v);
      break;
    }
  }
  return chain;
}

/** Page views that do not set the delta baseline (see presentSnapshot in delta.ts). */
const NO_BASELINE_TOOLS = new Set(["browser_read", "browser_screenshot"]);

function decide(h: History, turns: number): { collapse: Set<number>; newestChain: Set<number> } {
  const views = h.entries.filter((e) => !e.error);
  const keep = new Set<number>();
  const newestChain = new Set<number>();
  if (views.length) {
    for (const v of chainOf(views, views.length - 1)) {
      keep.add(v.index);
      newestChain.add(v.index);
    }
    // The driver's delta baseline is the last view a snapshot produced; reads and screenshots do not move it. When the newest
    // view is one of those, the next action result may still be a delta against that snapshot, so it must stay in full.
    const newestView = views[views.length - 1]!;
    const root = views.findLastIndex((v) => !NO_BASELINE_TOOLS.has(v.msg.toolName));
    if (root >= 0 && views[root]!.doc === newestView.doc) {
      for (const v of chainOf(views, root)) {
        keep.add(v.index);
        newestChain.add(v.index);
      }
    }
    // A document is current while its last event is the model's latest; otherwise count assistant turns since it left.
    const lastEvent = new Map<string, number>();
    h.events.forEach((e, i) => lastEvent.set(e.doc, i));
    const latestOfDoc = new Map<string, number>();
    views.forEach((v, i) => latestOfDoc.set(v.doc, i));
    for (const [doc, at] of latestOfDoc) {
      const next = h.events[lastEvent.get(doc)! + 1];
      const fresh = !next || h.assistants.filter((a) => a > next.index).length <= turns;
      if (fresh) for (const v of chainOf(views, at)) keep.add(v.index);
    }
  }
  const newest = h.entries[h.entries.length - 1];
  const collapse = new Set<number>();
  for (const e of h.entries) {
    // A failed result is tiny and the model is reacting to it while it is the newest thing it did.
    if (e.id && !keep.has(e.index) && !(e.error && e === newest)) collapse.add(e.index);
  }
  return { collapse, newestChain };
}

// ---- The one-line form ----

const hostPath = (url: string): string => {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url.replace(/^[a-z]+:\/\//i, "").split(/[?#]/)[0]!;
  }
};
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Name of the element behind `ref` in a view's body, from a line like `[e12] button "Contact"`; undefined if it is not there. */
function nameOf(body: string, ref: string): string | undefined {
  const m = new RegExp(`\\[${ref}\\][^\\n]*?"((?:[^"\\\\\\n]|\\\\.)*)"`).exec(body);
  return m?.[1] ? cut(flat(m[1]), MAX_NAME) : undefined;
}

const refNumber = (ref: string) => (/^e(\d+)$/.exec(ref) ? Number(ref.slice(1)) : undefined);

/** Refs from one fill call, with contiguous runs of three or more written `e20..e24`. */
function fillRuns(refs: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < refs.length; ) {
    let j = i;
    const start = refNumber(refs[i]!);
    while (start !== undefined && refNumber(refs[j + 1] ?? "") === start + (j + 1 - i)) j++;
    if (j - i >= 2) out.push(`${refs[i]}..${refs[j]} (fill)`);
    else for (let k = i; k <= j; k++) out.push(`${cut(refs[k]!, MAX_NAME)} (fill)`);
    i = j + 1;
  }
  return out;
}

const REF_ACTIONS = new Set(["browser_click", "browser_type", "browser_select", "browser_press", "browser_scroll", "browser_choose"]);

/** What the model did to the page while `e` was its latest view, as `e12 (click "Contact")` items. */
function actedOn(calls: Call[], e: Entry): string[] {
  const out: string[] = [];
  for (const c of calls) {
    if (c.name === "browser_fill") {
      const fields = Array.isArray(c.args.fields) ? (c.args.fields as { ref?: unknown }[]) : [];
      out.push(...fillRuns(fields.map((f) => f?.ref).filter((r): r is string => typeof r === "string")));
      if (typeof c.args.submit === "string" && refNumber(c.args.submit) !== undefined) out.push(`${c.args.submit} (submit)`);
    } else if (REF_ACTIONS.has(c.name) && typeof c.args.ref === "string") {
      const name = refNumber(c.args.ref) !== undefined ? nameOf(e.body, c.args.ref) : undefined;
      out.push(`${cut(c.args.ref, MAX_NAME)} (${c.name.slice("browser_".length)}${name ? ` "${name}"` : ""})`);
    }
  }
  return out;
}

function lineFor(e: Entry, calls: Call[]): string {
  const path = e.url ? hostPath(e.url) : "";
  if (e.error) return `[earlier failed ${e.msg.toolName}${path ? ` on ${path}` : ""}]`;
  const detail = [e.title ? cut(flat(e.title), MAX_TITLE) : "", e.msg.toolName === "browser_read" ? "text view" : e.elements !== undefined ? `${e.elements} element${e.elements === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(", ");
  const head = `[earlier view of ${path || "an unknown page"}${detail ? `: ${detail}` : ""}`;
  const actions = actedOn(calls, e);
  if (!actions.length) return `${head}]`;
  const prefix = "; acted on: ";
  const kept: string[] = [];
  for (const a of actions) {
    // Leave room for a trailing ", …" and the closing bracket.
    if ((head + prefix + [...kept, a].join(", ")).length + 4 > MAX_LINE) break;
    kept.push(a);
  }
  return `${head}${prefix}${kept.join(", ")}${kept.length < actions.length ? (kept.length ? ", …" : "…") : ""}]`;
}

/** `messages` with the page views whose ids are in `ids` replaced by their one-line form; all other messages are the same objects. */
export function applyCollapse<T>(messages: T[], ids: ReadonlySet<string>, protect?: ReadonlySet<number>): T[] {
  if (!ids.size) return messages;
  const h = readHistory(messages);
  const out = messages.slice();
  h.entries.forEach((e, n) => {
    // `protect`: message indexes that stay in full whatever their id (a reused tool-call id must not hit the newest view).
    if (!e.id || !ids.has(e.id) || protect?.has(e.index) || isCollapsed(e.msg)) return;
    const until = h.entries[n + 1]?.index ?? messages.length;
    const calls = h.calls.filter((c) => c.index > e.index && c.index < until);
    out[e.index] = { ...e.msg, content: [{ type: "text", text: lineFor(e, calls) }] } as T;
  });
  return out;
}

/**
 * Stage 1: collapses older page views (see the file comment). Views collapsed here are added to `state.collapsed` and stay
 * collapsed in later calls with the same state. Results without a tool-call id are never touched.
 */
export function collapsePageViews<T>(messages: T[], state: CollapseState, options: CollapseOptions = {}): CollapseResult<T> {
  const turns = options.staleDocumentTurns ?? parseStaleDocumentTurns(process.env.PI_BROWSER_STALE_DOC_TURNS) ?? DEFAULT_STALE_DOCUMENT_TURNS;
  const h = readHistory(messages);
  const { collapse, newestChain } = decide(h, turns);
  const newly: string[] = [];
  for (const e of h.entries) {
    if (e.id && collapse.has(e.index) && !state.collapsed.has(e.id) && !options.stubbed?.has(e.id)) {
      state.collapsed.add(e.id);
      newly.push(e.id);
    }
  }
  const chainIds = new Set<string>();
  for (const e of h.entries) if (e.id && newestChain.has(e.index)) chainIds.add(e.id);
  return { messages: applyCollapse(messages, state.collapsed), newlyCollapsed: newly, newestChain: chainIds };
}
