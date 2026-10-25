/**
 * Offline replay of a saved session through the request-side context hooks, to measure how big each prompt would
 * have been. For every assistant turn it feeds the messages before that turn through the hook chain (in extension
 * order) and records the estimated size before and after. Pure: no Pi runtime, no model calls.
 */
import { readFileSync } from "node:fs";
import { createPageViewCompactor } from "@pista/pi-browser";
import { contextPruneOptions, pruneContext, type CollapseState } from "./context-prune.ts";

/** A context hook as Pi runs it: the messages of a request in, the messages actually sent out. */
export type ContextHook = (messages: any[]) => any[];

export interface TurnStat {
  /** 1-based index of the assistant message the request precedes. */
  turn: number;
  charsBefore: number;
  charsAfter: number;
  tokensBefore: number;
  tokensAfter: number;
}

const CHARS_PER_TOKEN = 2.5;
const IMAGE_TOKENS = 1_500;

/** Characters and image parts in a message list (text, thinking, tool-call JSON). */
function measure(messages: any[]): { chars: number; images: number } {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    const c = m?.content;
    if (typeof c === "string") {
      chars += c.length;
      continue;
    }
    if (!Array.isArray(c)) continue;
    for (const p of c) {
      if (p?.type === "image") images++;
      else if (p?.type === "text") chars += (p.text ?? "").length;
      else if (p?.type === "thinking") chars += (p.thinking ?? "").length;
      else if (p?.type === "toolCall") chars += (p.name ?? "").length + JSON.stringify(p.arguments ?? {}).length;
    }
  }
  return { chars, images };
}

const tokens = ({ chars, images }: { chars: number; images: number }) => Math.round(chars / CHARS_PER_TOKEN + images * IMAGE_TOKENS);

/** Message entries of a parsed session file, in file order; other entry types are ignored. */
export function sessionMessages(entries: any[]): any[] {
  return entries.filter((e) => e?.type === "message" && e.message).map((e) => e.message);
}

export function parseSession(jsonl: string): any[] {
  return jsonl.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * Replays `entries` (parsed session lines) through `hooks`, first to last. Hooks are usually stateful, so pass fresh ones
 * per replay. Assistant `usage` is dropped first so size estimates come from content, not from what the original run reported.
 */
export function replaySession(entries: any[], hooks: ContextHook[]): TurnStat[] {
  const messages = sessionMessages(entries).map((m) => {
    if (m.role !== "assistant" || !("usage" in m)) return m;
    const { usage: _usage, ...rest } = m;
    return rest;
  });
  const stats: TurnStat[] = [];
  let turn = 0;
  messages.forEach((m, k) => {
    if (m.role !== "assistant") return;
    turn++;
    const before = messages.slice(0, k);
    const after = hooks.reduce((acc, hook) => hook(acc), before);
    const b = measure(before);
    const a = measure(after);
    stats.push({ turn, charsBefore: b.chars, charsAfter: a.chars, tokensBefore: tokens(b), tokensAfter: tokens(a) });
  });
  return stats;
}

/** The hook chain Pista runs: pi-browser's page-view compactor, then (unless `host` is false) the host pruner. */
export function defaultHooks(opts: { host?: boolean; window?: number; env?: Record<string, string | undefined> } = {}): ContextHook[] {
  const window = opts.window ?? 32_768;
  const hooks: ContextHook[] = [createPageViewCompactor(() => Math.floor(window * 0.65), 1, () => 2_500)];
  if (opts.host !== false) {
    const options = contextPruneOptions({ contextWindow: window }, opts.env ?? {});
    const state: CollapseState = new Map();
    if (options) hooks.push((messages) => pruneContext(messages, options, state));
  }
  return hooks;
}

export function loadSession(path: string): any[] {
  return parseSession(readFileSync(path, "utf8"));
}

/** A compact fixed-width table plus totals, for stdout. */
export function formatStats(stats: TurnStat[]): string {
  const lines = ["turn  before  after"];
  for (const s of stats) lines.push(`${String(s.turn).padStart(4)}  ${String(s.tokensBefore).padStart(6)}  ${String(s.tokensAfter).padStart(5)}`);
  const before = stats.reduce((n, s) => n + s.tokensBefore, 0);
  const after = stats.reduce((n, s) => n + s.tokensAfter, 0);
  lines.push(`total ${before} -> ${after} tokens (${before ? (after / before).toFixed(2) : "n/a"}x)`);
  return lines.join("\n");
}
