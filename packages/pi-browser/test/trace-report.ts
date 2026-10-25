/**
 * Per-turn report over a trace written by trace-proxy.ts (see there).
 *
 *   cd packages/pi-browser && npx tsx test/trace-report.ts <trace dir> [task] [--diff] [--dump <turn>]
 *
 * One table per task/run, one row per model request: prompt tokens, how many came from the server's prompt cache (cache_n) and how many were
 * newly prefilled (prompt_n), the cache-hit share, prefill and decode time, characters of message text in the request, and the size of the latest
 * tool result. `first diff` says where the request stops being a byte-for-byte continuation of the previous one: the index of the first message
 * that differs, the first differing character in it (-1 = previous messages are a strict prefix), and whether tools/system differ.
 * --diff prints the differing message pair for each break; --dump N prints the full messages of turn N of the first listed run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Rec {
  seq: number;
  task?: string;
  run?: number;
  wallMs: number;
  request: { messages: Msg[]; tools?: unknown };
  response: { text: string; reasoning: string; toolCalls: { name: string; arguments: string }[]; finishReason?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  timings?: { cache_n?: number; prompt_n?: number; prompt_ms?: number; predicted_n?: number; predicted_ms?: number };
}
type Msg = { role: string; content?: unknown; tool_calls?: unknown };

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const dumpAt = args.includes("--dump") ? Number(args[args.indexOf("--dump") + 1]) : undefined;
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--dump"));
const dir = positional[0];
if (!dir) throw new Error("usage: trace-report.ts <trace dir> [task] [--diff] [--dump <turn>]");
const taskFilter = positional[1];

const recs: Rec[] = readFileSync(join(dir, "requests.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const contentText = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p?.type === "text" ? p.text ?? "" : `[${p?.type}]`)).join("") : JSON.stringify(c ?? ""));
const msgChars = (m: Msg) => contentText(m.content).length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
const ser = (m: Msg) => JSON.stringify(m);
const pad = (v: unknown, n: number) => String(v).padStart(n);

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i === a.length && i === b.length ? -2 : i; // -2 identical
}

const groups = new Map<string, Rec[]>();
for (const r of recs) {
  if (taskFilter && r.task !== taskFilter) continue;
  const k = `${r.task ?? "?"} run ${r.run ?? "?"}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}

let first = true;
for (const [key, list] of groups) {
  console.log(`\n== ${key}  (${list.length} model requests)`);
  console.log(["turn", "prompt", "cache_n", "prompt_n", "hit%", "prefill_ms", "decode_ms", "out_tok", "ctx_chars", "tool_chars", "first diff vs prev request", "response"].join("  "));
  let prev: Rec | undefined;
  list.forEach((r, i) => {
    const t = r.timings ?? {};
    const prompt = r.usage?.prompt_tokens ?? (t.cache_n ?? 0) + (t.prompt_n ?? 0);
    const hit = prompt ? Math.round(((t.cache_n ?? 0) / prompt) * 100) : 0;
    const msgs = r.request.messages;
    const ctx = msgs.reduce((n, m) => n + msgChars(m), 0);
    const lastTool = [...msgs].reverse().find((m) => m.role === "tool");
    const trailing = msgs.at(-1)?.role === "tool" ? msgChars(lastTool!) : 0;
    let diff = "-";
    if (prev) {
      const pm = prev.request.messages;
      let k = 0;
      while (k < pm.length && k < msgs.length && ser(pm[k]!) === ser(msgs[k]!)) k++;
      const toolsSame = JSON.stringify(prev.request.tools) === JSON.stringify(r.request.tools);
      diff = k === pm.length ? `prev msgs[0..${pm.length - 1}] identical` : `msg ${k} (${pm[k]?.role}) differs at char ${firstDiff(ser(pm[k]!), ser(msgs[k] ?? { role: "" }))}`;
      if (!toolsSame) diff += " TOOLS DIFFER";
      if (flag("--diff") && k < pm.length) {
        console.log(`--- turn ${i + 1}: previous msg ${k}:\n${ser(pm[k]!).slice(0, 700)}\n+++ this request msg ${k}:\n${ser(msgs[k] ?? { role: "(missing)" }).slice(0, 700)}`);
      }
    }
    const resp = r.response.toolCalls.length ? r.response.toolCalls.map((c) => `${c.name}(${c.arguments.slice(0, 40)})`).join(",") : `text:${r.response.text.slice(0, 40).replace(/\s+/g, " ")}`;
    console.log([pad(i + 1, 4), pad(prompt, 6), pad(t.cache_n ?? 0, 7), pad(t.prompt_n ?? 0, 8), pad(hit, 4), pad(Math.round(t.prompt_ms ?? 0), 10), pad(Math.round(t.predicted_ms ?? 0), 9), pad(t.predicted_n ?? r.usage?.completion_tokens ?? 0, 7), pad(ctx, 9), pad(trailing, 10), diff, resp].join("  "));
    if (first && dumpAt === i + 1) console.log(`--- dump turn ${dumpAt}:\n${JSON.stringify(r.request.messages, null, 2)}\n--- reasoning:\n${r.response.reasoning}`);
    prev = r;
  });
  const sum = (f: (r: Rec) => number) => list.reduce((n, r) => n + f(r), 0);
  const cached = sum((r) => r.timings?.cache_n ?? 0);
  const newly = sum((r) => r.timings?.prompt_n ?? 0);
  console.log(`total: prompt ${cached + newly} tok = ${cached} cached + ${newly} prefilled (${Math.round((cached / Math.max(1, cached + newly)) * 100)}% hit), prefill ${Math.round(sum((r) => r.timings?.prompt_ms ?? 0))} ms, decode ${Math.round(sum((r) => r.timings?.predicted_ms ?? 0))} ms, out ${sum((r) => r.timings?.predicted_n ?? 0)} tok, wall ${Math.round(sum((r) => r.wallMs))} ms`);
  first = false;
}
