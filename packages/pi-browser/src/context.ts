/**
 * Keeps old page views out of the model's context once it gets large. LLM APIs are stateless, so every turn
 * resends the whole conversation; without this, each snapshot, page read and screenshot the agent ever took rides
 * along on every later request, long after the page changed.
 *
 * Runs on pi's `context` event, which only shapes the outgoing request: the session file and the transcript keep
 * the full results. Two stages:
 *
 * 1. Collapse (collapse.ts), on every request: older page views shrink to one line each, the latest view of the current
 *    document stays in full. This keeps the prompt roughly flat.
 * 2. Budget (below), a harsher pass once the estimated request passes a share of the context window.
 *
 * Stage 2 in detail. History is append-only until it needs to shrink. Stubbing a result on every step changes the token sequence at
 * that result, so llama.cpp (and hosted prompt caches) can reuse only the prefix before it: a traced session saw
 * 46% cache hits on steps with a newly stubbed result versus 96-99% otherwise. It also threw away evidence the
 * answer needed. So below a budget nothing is touched; once the estimated request exceeds the budget, all old page
 * views are stubbed at once, and those stay stubbed in every later request (the prefix breaks once per compaction,
 * not once per step). The latest page view is always kept in full.
 *
 * Stickiness (both stages) is keyed by tool-call id and held in memory only, per registered hook.
 * A result without an id is never stubbed or collapsed.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyCollapse, collapsePageViews, isCollapsed, isPageView, PAGE_VIEW_TOOLS, type CollapseOptions, type CollapseState, type ToolResultLike } from "./collapse.ts";
import { invalidateDeltaBaselines } from "./delta.ts";

export { PAGE_VIEW_TOOLS };

const STUB =
  "[Page content from this step was removed from the context: later page views supersede it. Use browser_snapshot or browser_read to see the current page.]";

/** Compact when the estimated request passes this share of the model's context window. */
export const DEFAULT_COMPACT_FRACTION = 0.65;
/** Window assumed when the hook does not expose the model's. */
export const DEFAULT_CONTEXT_WINDOW = 32768;
/** Rough token cost of one image part. */
const IMAGE_TOKENS = 1500;

/** Stable identity of a tool result across requests: its tool-call id. Results without one are never stubbed. */
const keyOf = (m: ToolResultLike) => m.toolCallId;

/**
 * Characters per token assumed for message content. Deliberately conservative (an underestimate of the real ratio):
 * calibrated against Gemma 4 traces on Oct 20 2026, where 208 replayed requests with real tokenization showed
 * chars/4 undercounting by a median 1.58x (max 1.96x) on page snapshots and JSON tool output.
 */
export const CHARS_PER_TOKEN = 2.5;
/**
 * Tokens assumed for the system prompt and tool definitions when the hook does not expose them (same Oct 20 2026
 * Gemma 4 calibration: about 2,000 measured, rounded up).
 */
export const DEFAULT_OVERHEAD_TOKENS = 2500;

/** Rough token estimate of messages alone (CHARS_PER_TOKEN chars each; images a flat cost). */
export function estimateTokens(messages: unknown[]): number {
  let chars = 0;
  for (const m of messages as { content?: unknown }[]) {
    if (typeof m.content === "string") chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const p of m.content as { type?: string; text?: string; thinking?: string; arguments?: unknown }[]) {
        if (p.type === "image") chars += IMAGE_TOKENS * CHARS_PER_TOKEN;
        else chars += (p.text?.length ?? 0) + (p.thinking?.length ?? 0) + (p.arguments ? JSON.stringify(p.arguments).length : 0);
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Real size of the request that produced the latest usable assistant message, taken from its reported usage, and
 * where that message sits. Prompt tokens are input + cache reads + cache writes; the reply itself is output, and
 * it rides along in the next request. Errored or aborted replies and ones without counts are skipped.
 */
function lastRealUsage(messages: unknown[]): { tokens: number; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; stopReason?: string; usage?: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite", number>> };
    if (m.role !== "assistant" || !m.usage || m.stopReason === "error" || m.stopReason === "aborted") continue;
    const prompt = (m.usage.input ?? 0) + (m.usage.cacheRead ?? 0) + (m.usage.cacheWrite ?? 0);
    if (prompt > 0) return { tokens: prompt + (m.usage.output ?? 0), index: i };
  }
  return undefined;
}

/**
 * Estimated size of the next request. When an earlier reply carries real usage, that count plus a conservative
 * estimate of what was appended after it (`saved` is subtracted for views stubbed since that request was sent).
 * Otherwise a calibrated estimate: the messages plus `overhead` for the system prompt and tool definitions.
 */
export function estimatePromptTokens(messages: unknown[], overhead = DEFAULT_OVERHEAD_TOKENS, saved = 0): number {
  const real = lastRealUsage(messages);
  if (real) return Math.max(0, real.tokens - saved) + estimateTokens(messages.slice(real.index + 1));
  return estimateTokens(messages) + overhead;
}

/**
 * Token budget from an env-style value: a fraction of the window when in (0, 1], else an absolute token count.
 * Unset or invalid falls back to DEFAULT_COMPACT_FRACTION of the window.
 */
export function resolveCompactBudget(setting: string | undefined, contextWindow = DEFAULT_CONTEXT_WINDOW): number {
  const n = Number(setting);
  if (setting?.trim() && Number.isFinite(n) && n > 0) return n <= 1 ? n * contextWindow : n;
  return DEFAULT_COMPACT_FRACTION * contextWindow;
}

/**
 * Returns `messages` with all but the latest `keep` page views reduced to their first text part (the small
 * url/title/result header) plus a stub. With `only`, just the views whose key is in the set are stubbed. Messages
 * that need no change are returned as the same objects.
 */
export function prunePageViews<T>(messages: T[], keep = 1, only?: ReadonlySet<string>): T[] {
  let seen = 0;
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    // A view stage 1 already reduced to one line is smaller than the stub, and says more.
    if (!isPageView(m) || isCollapsed(m)) continue;
    if (++seen <= keep) continue;
    const key = keyOf(m);
    if (!key || (only && !only.has(key))) continue;
    const header = m.content.find((p) => p.type === "text");
    const alreadyStubbed = m.content.length === 2 && m.content[1]?.text === STUB;
    if (alreadyStubbed) continue;
    out[i] = { ...m, content: [...(header ? [header] : []), { type: "text", text: STUB }] } as T;
  }
  return out;
}

export type CompactorOptions = Pick<CollapseOptions, "staleDocumentTurns">;

/**
 * Stateful per-session compactor. Stage 1 collapses older page views on every request (see collapse.ts). Stage 2: request
 * history passes through untouched until its estimated size exceeds `budget()`; then every page view but the latest `keep`
 * is stubbed and remembered, so later requests stub the same ones.
 */
export function createPageViewCompactor(budget: () => number, keep = 1, overhead: () => number = () => 0, options: CompactorOptions = {}) {
  const collapseState: CollapseState = { collapsed: new Set() };
  const stubbed = new Set<string>();
  // What was collapsed and stubbed in the request the latest reply answered, so real usage can be corrected for later shrinking.
  let sent = new Set<string>();
  let sentCollapsed = new Set<string>();
  return <T>(messages: T[]): T[] => {
    const stage1 = collapsePageViews(messages, collapseState, { ...options, stubbed });
    const base = stage1.messages;
    let out = stubbed.size ? prunePageViews(base, keep, stubbed) : base;
    const extra = overhead();
    const saved = () => estimateTokens(prunePageViews(applyCollapse(messages, sentCollapsed), keep, sent)) - estimateTokens(out);
    if (estimatePromptTokens(out, extra, sent.size || sentCollapsed.size ? saved() : 0) > budget()) {
      let seen = 0;
      let removedChain = false;
      for (let i = base.length - 1; i >= 0; i--) {
        const m = base[i];
        if (!isPageView(m) || isCollapsed(m) || ++seen <= keep) continue;
        const key = keyOf(m);
        if (!key || stubbed.has(key)) continue;
        stubbed.add(key);
        if (stage1.newestChain.has(key)) removedChain = true;
      }
      out = prunePageViews(base, keep, stubbed);
      // Delta results (PI_BROWSER_DELTA) are read against the newest view and the full view behind it. Stage 1 always keeps
      // those, so only this stage can drop one: then the next result must be a full snapshot, not a delta of a stubbed view.
      if (removedChain) invalidateDeltaBaselines();
    }
    sent = new Set(stubbed);
    sentCollapsed = new Set(collapseState.collapsed);
    return out;
  };
}

/**
 * Registers the compaction hook; `keep` is how many of the most recent page views stay complete in the budget stage. The
 * budget is PI_BROWSER_COMPACT_AT (tokens, or a fraction of the window when <= 1), default 65% of the model's window.
 */
export function registerContextPruning(pi: ExtensionAPI, keep = 1, options: CompactorOptions = {}) {
  let window = DEFAULT_CONTEXT_WINDOW;
  let overhead = DEFAULT_OVERHEAD_TOKENS;
  const compact = createPageViewCompactor(() => resolveCompactBudget(process.env.PI_BROWSER_COMPACT_AT, window), keep, () => overhead, options);
  pi.on("context", (event, ctx) => {
    window = ctx?.model?.contextWindow || DEFAULT_CONTEXT_WINDOW;
    overhead = measureOverhead(pi, ctx) ?? DEFAULT_OVERHEAD_TOKENS;
    return { messages: compact(event.messages) };
  });
}

/** Tokens taken by the system prompt and the declared tools, when the hook exposes them; undefined otherwise. */
function measureOverhead(pi: ExtensionAPI, ctx: { getSystemPrompt?: () => string } | undefined): number | undefined {
  try {
    const prompt = ctx?.getSystemPrompt?.() ?? "";
    const active = new Set(pi.getActiveTools?.() ?? []);
    const tools = (pi.getAllTools?.() ?? []).filter((t) => active.has(t.name)).map(({ name, description, parameters }) => ({ name, description, parameters }));
    const chars = prompt.length + (tools.length ? JSON.stringify(tools).length : 0);
    return prompt && tools.length ? Math.ceil(chars / CHARS_PER_TOKEN) : undefined;
  } catch {
    return undefined;
  }
}
