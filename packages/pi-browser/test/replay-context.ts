/**
 * Replays a recorded pi session and estimates per-turn request size with and without page-view pruning.
 *   npx tsx test/replay-context.ts <session.jsonl> [keep]
 * Tokens ≈ chars / 4; BASE is the system prompt + tool definitions (the first turn's input when no history exists).
 */
import { readFileSync } from "node:fs";
import { prunePageViews } from "../src/context.ts";

const [file, keepArg] = process.argv.slice(2);
const keep = Number(keepArg ?? 2);
const entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const messages = entries.filter((e) => e.type === "message").map((e) => e.message);
const firstUsage = messages.find((m) => m.role === "assistant" && m.usage)?.usage;
const BASE = (firstUsage?.input ?? 4000) * 4 - JSON.stringify(messages[0]).length; // chars of prompt + tools

const size = (ms: unknown[]) => ms.map((m) => JSON.stringify(m));
const run = (prune: boolean) => {
  let total = 0, fresh = 0, prev: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "assistant") continue;
    const ctx = size(prune ? prunePageViews(messages.slice(0, i), keep) : messages.slice(0, i));
    let same = 0;
    while (same < prev.length && same < ctx.length && prev[same] === ctx[same]) same++;
    const chars = ctx.reduce((n, s) => n + s.length, 0);
    const freshChars = ctx.slice(same).reduce((n, s) => n + s.length, 0) + (prev.length ? 0 : BASE);
    total += BASE + chars;
    fresh += freshChars;
    prev = ctx;
  }
  return { total: Math.round(total / 4), fresh: Math.round(fresh / 4) };
};
const before = run(false), after = run(true);
const turns = messages.filter((m) => m.role === "assistant").length;
const last = (p: boolean) => Math.round((BASE + size(p ? prunePageViews(messages, keep) : messages).reduce((n, s) => n + s.length, 0)) / 4);
console.log(`turns ${turns}, keep ${keep}`);
console.log(`input tokens, all turns:   ${before.total} → ${after.total} (${Math.round((1 - after.total / before.total) * 100)}% less)`);
console.log(`fresh (uncached) tokens:   ${before.fresh} → ${after.fresh}`);
console.log(`context at end of session: ${last(false)} → ${last(true)}`);
