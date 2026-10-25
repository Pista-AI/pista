import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { PAGE_VIEW_TOOLS } from "@pista/pi-browser";
import type { ConfigStore } from "./config.ts";
import { isLocalProvider } from "./local.ts";

/**
 * Keeps the prompt small for small-window models by replacing redundant or stale tool results with
 * one-line stubs in what is sent to the model. Deterministic, no model calls, nothing persisted: the
 * `context` hook's result is not stored, so the session file and the UI keep the full output.
 *
 * Rules. Results of the current turn (after the last assistant message) and the newest result are
 * never touched. The `keepRecent` newest results are only touched by the budget pass.
 * - Batching: results before a boundary are candidates, and the boundary advances in steps of
 *   `batch` results (not one per step), so the prompt prefix changes once per batch and the
 *   server's prompt cache survives in between.
 * - Dedup: of several candidates from the same tool with deep-equal arguments (a result is paired
 *   with the nearest preceding call carrying its id; errors are skipped), only the newest of the
 *   group stays verbatim. Applies whatever the size. If the newest twin is itself stubbed later, the
 *   older ones get an ordinary stub.
 * - Staleness: candidates over `minChars` are stubbed.
 * - Budget: while the total exceeds `maxToolChars`, older results are stubbed oldest first, ignoring
 *   `keepRecent` and the batch. Protected tools' results are exempt from every rule above, but as a
 *   last resort (only if the budget cannot be met otherwise) they are stubbed oldest first too.
 * A stub is never used when it would be longer than the result.
 * Browser page views (`PAGE_VIEW_TOOLS` from pi-browser) are exempt from all of it, even the last resort: pi-browser's own
 * context hook compacts them once, past a budget, and rewriting them here would change the prompt prefix every few steps.
 *
 * Options (`PruneOptions`, built by `contextPruneOptions`): keepRecent, minChars, maxToolChars
 * (default `max(8000, floor(window * 1.5))`), batch, protectedTools.
 * Environment, read once when the extension is created:
 * - `PISTA_CONTEXT_PRUNE=off` disables everything.
 * - `PISTA_CONTEXT_PRUNE_KEEP=<n>` sets keepRecent (default 4).
 * - `PISTA_CONTEXT_PRUNE_PROTECT=a,b` replaces the protected tool list (default `write,edit`).
 *   Names are trimmed and case-sensitive; an empty value protects nothing.
 * - `PISTA_PRUNE_RESULT_CHARS=<n>` sets minChars (default 600): older results up to this long stay verbatim.
 *
 * Search collapse (`collapseSearchResults`, runs before the rules above). `web_search` and `fetch_content`
 * results (pi-web-access) are replaced by one line once the model has moved on: after a later assistant
 * `browser_navigate`, or after two further assistant turns, whichever comes first. The line names the query, which
 * listed URLs were visited and how many others there were. The line is fixed the first time it is written and kept
 * (by tool-call id, in memory) so the prompt prefix stays stable. Results without an id are left alone. The pass only
 * starts on threads that have made at least one `browser_*` tool call; research threads keep their search results. Lines
 * already written keep being applied if those calls later leave the request.
 */

export interface PruneOptions {
  /** The newest this many tool results are always sent verbatim. */
  keepRecent: number;
  /** Older tool results at or below this many characters are sent verbatim. */
  minChars: number;
  /** Total characters of tool results the prompt may carry; older ones are stubbed until under it. */
  maxToolChars: number;
  /** Stale results are stubbed only once this many are waiting, so the prompt prefix stays stable between batches. */
  batch: number;
  /** Tools whose results are never stubbed by either pass. */
  protectedTools: string[];
}

export const DEFAULT_KEEP_RECENT = 4;
export const DEFAULT_MIN_CHARS = 600;
/** Tools whose results are collapsed to a summary line once the model has acted on them (pi-web-access). */
export const SEARCH_TOOLS: ReadonlySet<string> = new Set(["web_search", "fetch_content"]);
/** Assistant turns after a search result before it is collapsed even though no page was opened. */
const COLLAPSE_AFTER_TURNS = 2;
export const DEFAULT_BATCH = 4;
export const DEFAULT_PROTECTED_TOOLS = ["write", "edit"];
const MIN_BUDGET_CHARS = 8_000;
/** Window assumed when the model does not report one. */
const FALLBACK_WINDOW = 32_768;
/** A rough size for an image part, which has no text length but costs real tokens. */
const IMAGE_CHARS = 1_000;

/** The slice of a message this module reads. Real messages (Pi's `AgentMessage`) satisfy it structurally. */
interface Part {
  type: string;
  text?: string;
}
interface CallPart extends Part {
  id?: string;
  name?: string;
  arguments?: unknown;
}
interface Msg {
  role: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  content?: unknown;
}

function parts(m: Msg): Part[] {
  return Array.isArray(m.content) ? (m.content as Part[]) : [];
}

function textOf(m: Msg): string {
  return parts(m)
    .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
    .join("\n");
}

function sizeOf(m: Msg): number {
  return parts(m).reduce((n, p) => n + (p.type === "text" ? (p.text?.length ?? 0) : IMAGE_CHARS), 0);
}

function stub(m: Msg): string {
  const text = textOf(m);
  const lines = text ? text.split("\n").length : 0;
  return `[Output pruned to save context: ${m.toolName ?? "tool"}, ${text.length} chars, ${lines} lines. Re-run the tool if you need it again.]`;
}

function dupStub(m: Msg): string {
  return `[Duplicate output pruned: ${m.toolName ?? "tool"} was called again with the same arguments; see the later result.]`;
}

/** JSON with object keys sorted, so equal arguments compare equal whatever their key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** The tool call a result answers: its name and a stable key for its arguments (undefined when they cannot be serialised). */
interface SeenCall {
  name: string | undefined;
  key: string | undefined;
}

/**
 * A copy of `messages` where redundant and stale tool results are replaced by a one-line stub (image
 * parts dropped); see the file comment for the rules. Never mutates its input; unchanged messages are
 * returned by reference.
 */
export function pruneToolResults<M extends { role: string }>(messages: M[], options: PruneOptions): M[] {
  const msgs = messages as unknown as Msg[];
  const results: number[] = [];
  let lastAssistant = -1;
  msgs.forEach((m, i) => {
    if (m.role === "toolResult") results.push(i);
    if (m.role === "assistant") lastAssistant = i;
  });
  if (results.length === 0) return messages;

  const position = new Map(results.map((i, n) => [i, n]));
  const newest = results[results.length - 1]!;
  const protectedTools = new Set(options.protectedTools);
  const isProtected = (i: number) => protectedTools.has(msgs[i]!.toolName ?? "");
  // Results of the current turn and the newest are never touched. Oldest first.
  const settled = results.filter((i) => i < lastAssistant && i !== newest && !PAGE_VIEW_TOOLS.has(msgs[i]!.toolName ?? ""));
  const eligible = settled.filter((i) => !isProtected(i));

  // The batch rule. Every call sees the full history, so a boundary that slid with each result would
  // stub one more result per step and change the prompt prefix every turn. Instead the boundary moves
  // in steps of `batch`: results before it are candidates, the `keepRecent` newest never are.
  const batch = Math.max(1, Math.floor(options.batch));
  const boundary = Math.floor(Math.max(0, results.length - Math.max(0, options.keepRecent)) / batch) * batch;
  const candidates = eligible.filter((i) => position.get(i)! < boundary);

  const sizes = new Map(results.map((i) => [i, sizeOf(msgs[i]!)]));
  const pruned = new Set<number>();

  // Dedup: pair each result with the nearest preceding tool call that carries its id (ids may be
  // reused across turns), and group by tool name and arguments. Errors are left alone so a later
  // success cannot hide what a failure said.
  const seen = new Map<string, SeenCall>();
  const groups = new Map<string, number[]>();
  msgs.forEach((m, i) => {
    if (m.role === "assistant") {
      for (const part of parts(m) as CallPart[]) {
        if (part.type !== "toolCall" || !part.id) continue;
        let key: string | undefined;
        try {
          key = stableJson(part.arguments);
        } catch {
          key = undefined; // cyclic or BigInt arguments: no dedup for this call, pruning carries on
        }
        seen.set(part.id, { name: part.name, key });
      }
    } else if (m.role === "toolResult" && m.toolCallId && !m.isError) {
      const call = seen.get(m.toolCallId);
      if (!call || call.key === undefined || call.name !== m.toolName) return;
      const id = `${call.name}\u0000${call.key}`;
      groups.set(id, [...(groups.get(id) ?? []), i]);
    }
  });
  const candidateSet = new Set(candidates);
  const twin = new Map<number, number>(); // duplicate -> the newest result of its group
  for (const group of groups.values()) {
    const last = group[group.length - 1]!;
    for (const i of group.slice(0, -1)) {
      // The duplicate may fall back to the ordinary stub (see below), so it must beat the longer one.
      if (candidateSet.has(i) && sizes.get(i)! > maxStubLength(msgs[i]!)) twin.set(i, last);
    }
  }
  for (const i of twin.keys()) pruned.add(i);

  // Staleness: big results before the boundary.
  for (const i of candidates) {
    const size = sizes.get(i)!;
    // A one-line search collapse is already smaller and says more than the stub.
    if (textOf(msgs[i]!).startsWith("[earlier ")) continue;
    if (size > options.minChars && size > stub(msgs[i]!).length) pruned.add(i);
  }

  // Budget: stub older results oldest first until under budget. Protected results go last, and
  // only if the budget cannot be met otherwise.
  let total = 0;
  for (const i of results) total += pruned.has(i) ? maxStubLength(msgs[i]!) : sizes.get(i)!;
  for (const pool of [eligible, settled.filter(isProtected)]) {
    for (const i of pool) {
      if (total <= options.maxToolChars) break;
      if (pruned.has(i)) continue;
      const saved = sizes.get(i)! - stub(msgs[i]!).length;
      if (saved <= 0) continue;
      pruned.add(i);
      total -= saved;
    }
  }

  // A duplicate whose later twin was itself stubbed would point at nothing: it becomes an ordinary stub.
  for (const [i, last] of twin) if (pruned.has(last)) twin.delete(i);

  if (pruned.size === 0) return messages;
  return messages.map((m, i) =>
    pruned.has(i)
      ? ({ ...(m as object), content: [{ type: "text", text: twin.has(i) ? dupStub(m as unknown as Msg) : stub(m as unknown as Msg) }] } as unknown as M)
      : m,
  );
}

/** Collapsed lines by tool-call id; kept for the life of the extension so a line never changes once sent. */
export type CollapseState = Map<string, string>;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Lowercased host without `www.`, no fragment, no trailing slash; undefined for anything that is not an http(s) URL. */
export function normalizeUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.host.toLowerCase().replace(/^www\./, "")}${path}${u.search}`;
  } catch {
    return undefined;
  }
}

/**
 * URLs a search result lists. pi-web-access writes `Source: <title> (<url>)` per hit (exa, brave, duckduckgo, parallel);
 * with no such line every `http(s)://` URL in the text counts. Deduplicated by normalised form, in order.
 */
export function listedUrls(text: string): string[] {
  const sources = [...text.matchAll(/^Source:.*\((https?:\/\/[^\s()]+)\)\s*$/gm)].map((m) => m[1]!);
  const raw = sources.length > 0 ? sources : [...text.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
  const seen = new Set<string>();
  return raw.filter((u) => {
    const key = normalizeUrl(u) ?? u;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function queryOf(args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const qs = [...asStrings(a.queries), ...asStrings(a.query)].map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean);
  return cut(qs.join(" / "), 60);
}

function describeFetch(args: unknown, text: string): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const urls = [...asStrings(a.url), ...asStrings(a.urls)];
  let where = "?";
  if (urls[0]) {
    try {
      const u = new URL(urls[0]);
      where = `${u.host}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      where = urls[0];
    }
    if (urls.length > 1) where += ` +${urls.length - 1} more`;
  }
  const first = text.split("\n").map((l) => l.replace(/^[#>\s*-]+/, "").replace(/^Title:\s*/i, "").trim()).find(Boolean) ?? "";
  return `[earlier fetch_content of ${where}: ${cut(first, 60) || "no text"}, ${text.length} chars]`;
}

function describeSearch(args: unknown, text: string, navigated: string[]): string {
  const listed = listedUrls(text);
  const visited = listed.filter((u) => navigated.includes(normalizeUrl(u) ?? u));
  const q = queryOf(args);
  const head = `[earlier web_search results for "${q}": `;
  if (visited.length === 0) return `${head}visited none of them; ${listed.length} results]`;
  const others = listed.length - visited.length;
  return `${head}visited ${visited.map((u) => cut(u, 90)).join(", ")}; ${others} other results]`;
}

/**
 * Replaces `web_search` / `fetch_content` results the model has moved past with a one-line summary (see the file
 * comment). Returns a copy; `state` remembers each collapsed line by tool-call id. Unchanged messages are returned
 * by reference, and the input array itself when nothing changed.
 */
export function collapseSearchResults<M extends { role: string }>(messages: M[], state: CollapseState = new Map()): M[] {
  const msgs = messages as unknown as Msg[];
  const usesBrowser = msgs.some((m) => m.role === "assistant" && (parts(m) as CallPart[]).some((p) => p.type === "toolCall" && p.name?.startsWith("browser_")));
  // Lines already sent stay in place when the browser calls are gone from the request (Pi's compaction may drop them).
  if (!usesBrowser && state.size === 0) return messages;
  // Per index: assistant turns after it and the URLs navigated to after it (normalised), computed back to front.
  const turnsAfter = new Array<number>(msgs.length).fill(0);
  const navAfter: string[][] = new Array(msgs.length);
  let turns = 0;
  let navs: string[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    turnsAfter[i] = turns;
    navAfter[i] = navs;
    const m = msgs[i]!;
    if (m.role !== "assistant") continue;
    turns++;
    const here = (parts(m) as CallPart[])
      .filter((p) => p.type === "toolCall" && p.name === "browser_navigate")
      .map((p) => normalizeUrl(String((p.arguments as { url?: unknown } | undefined)?.url ?? "")))
      .filter((u): u is string => u !== undefined);
    if (here.length > 0) navs = [...navs, ...here];
  }

  const calls = new Map<string, unknown>(); // tool-call id -> arguments of the nearest preceding call
  let out: M[] | undefined;
  msgs.forEach((m, i) => {
    if (m.role === "assistant") {
      for (const p of parts(m) as CallPart[]) if (p.type === "toolCall" && p.id) calls.set(p.id, p.arguments);
      return;
    }
    if (m.role !== "toolResult" || !m.toolCallId || !SEARCH_TOOLS.has(m.toolName ?? "")) return;
    let line = state.get(m.toolCallId);
    if (line === undefined) {
      if (!usesBrowser) return;
      const acted = navAfter[i]!.length > 0;
      if (!acted && turnsAfter[i]! < COLLAPSE_AFTER_TURNS) return;
      const text = textOf(m);
      const args = calls.get(m.toolCallId);
      line = m.isError
        ? `[earlier failed ${m.toolName}]`
        : m.toolName === "web_search"
          ? describeSearch(args, text, navAfter[i]!)
          : describeFetch(args, text);
      state.set(m.toolCallId, line);
    }
    // Already a single matching part: leave it (also keeps the call idempotent on its own output).
    const ps = parts(m);
    if (ps.length === 1 && ps[0]!.type === "text" && ps[0]!.text === line) return;
    out ??= messages.slice();
    out[i] = { ...(m as object), content: [{ type: "text", text: line }] } as unknown as M;
  });
  return out ?? messages;
}

/** The search collapse followed by `pruneToolResults`, so the later passes see the shortened results. Pure apart from `state`. */
export function pruneContext<M extends { role: string }>(messages: M[], options: PruneOptions, state: CollapseState = new Map()): M[] {
  return pruneToolResults(collapseSearchResults(messages, state), options);
}

/** The longer of the two stubs a result may get, so size checks hold whichever it ends up with. */
function maxStubLength(m: Msg): number {
  return Math.max(stub(m).length, dupStub(m).length);
}

/** The environment variables this module reads. Passed explicitly so tests need not touch `process.env`. */
export interface PruneEnv {
  PISTA_CONTEXT_PRUNE?: string;
  PISTA_CONTEXT_PRUNE_KEEP?: string;
  PISTA_CONTEXT_PRUNE_PROTECT?: string;
  PISTA_PRUNE_RESULT_CHARS?: string;
}

/** Options for `model`, or undefined when pruning is switched off with `PISTA_CONTEXT_PRUNE=off`. */
export function contextPruneOptions(
  model: { contextWindow?: number } | undefined,
  env: PruneEnv = process.env,
): PruneOptions | undefined {
  if (env.PISTA_CONTEXT_PRUNE?.trim().toLowerCase() === "off") return undefined;
  const keep = Number.parseInt(env.PISTA_CONTEXT_PRUNE_KEEP ?? "", 10);
  const chars = Number.parseInt(env.PISTA_PRUNE_RESULT_CHARS ?? "", 10);
  const window = model?.contextWindow && model.contextWindow > 0 ? model.contextWindow : FALLBACK_WINDOW;
  return {
    keepRecent: Number.isInteger(keep) && keep >= 0 ? keep : DEFAULT_KEEP_RECENT,
    minChars: Number.isInteger(chars) && chars >= 0 ? chars : DEFAULT_MIN_CHARS,
    batch: DEFAULT_BATCH,
    // Unset keeps the default; an empty value protects nothing.
    protectedTools:
      env.PISTA_CONTEXT_PRUNE_PROTECT === undefined
        ? DEFAULT_PROTECTED_TOOLS
        : env.PISTA_CONTEXT_PRUNE_PROTECT.split(",")
            .map((t) => t.trim())
            .filter(Boolean),
    // About 37% of the window in tokens at ~4 chars per token, leaving room for the system prompt,
    // the conversation and the compaction reserve (33k chars at a 22k window, 49k at 32k).
    maxToolChars: Math.max(MIN_BUDGET_CHARS, Math.floor(window * 1.5)),
  };
}

/**
 * Drops `thinking` blocks from every assistant message except the last, so a small local model cannot copy its
 * earlier reasoning back verbatim (pi-ai replays past thinking as `reasoning_content`; Qwen3's own template strips it).
 * The last assistant message stays intact so a tool-call turn in progress is unchanged. Returns a copy; the input is not mutated.
 */
export function stripOldThinking<T extends { role: string; content?: unknown }>(messages: T[]): T[] {
  let last = -1;
  messages.forEach((m, i) => {
    if (m.role === "assistant") last = i;
  });
  let changed = false;
  const out = messages.map((m, i) => {
    if (m.role !== "assistant" || i === last || !Array.isArray(m.content)) return m;
    const kept = m.content.filter((p) => (p as { type?: string })?.type !== "thinking");
    if (kept.length === m.content.length) return m;
    changed = true;
    return { ...m, content: kept };
  });
  return changed ? out : messages;
}

/**
 * Applies `pruneContext` (search collapse, then `pruneToolResults`) through Pi's `context` hook, whose result is not persisted. For local models
 * (`store` tells which providers are local) it also drops replayed thinking, see `stripOldThinking`.
 */
export function contextPruneExtension(store?: Pick<ConfigStore, "config">): InlineExtension {
  // Read once: changing the environment mid-session has no effect.
  const env: PruneEnv = {
    PISTA_CONTEXT_PRUNE: process.env.PISTA_CONTEXT_PRUNE,
    PISTA_CONTEXT_PRUNE_KEEP: process.env.PISTA_CONTEXT_PRUNE_KEEP,
    PISTA_CONTEXT_PRUNE_PROTECT: process.env.PISTA_CONTEXT_PRUNE_PROTECT,
    PISTA_PRUNE_RESULT_CHARS: process.env.PISTA_PRUNE_RESULT_CHARS,
  };
  const collapsed: CollapseState = new Map();
  return {
    name: "context-prune",
    factory: (pi: ExtensionAPI) => {
      let warned = false;
      pi.on("context", (event, ctx) => {
        try {
          let messages = event.messages;
          const model = ctx.model;
          if (model && store && isLocalProvider(model.provider, model.baseUrl, store.config)) messages = stripOldThinking(messages);
          const options = contextPruneOptions(model, env);
          if (options) messages = pruneContext(messages, options, collapsed);
          return messages === event.messages ? undefined : { messages };
        } catch (err) {
          if (!warned) {
            warned = true;
            console.warn("[context-prune] falling back to unpruned messages after an error:", err);
          }
          return undefined;
        }
      });
    },
  };
}
