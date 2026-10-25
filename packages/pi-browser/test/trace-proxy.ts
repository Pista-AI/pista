/**
 * Diagnostic logging proxy for llama-server (test-only, off unless you start it). Sits between the eval suite and llama-server and writes one JSONL
 * record per /v1/chat/completions request: the full request body (messages + tools), the reassembled response (text, reasoning, tool calls,
 * finish reason), usage and llama-server's `timings`. Other /v1/* paths are forwarded untouched. A request the client abandoned mid-stream is
 * still recorded, with `aborted: true`, and its upstream request is cancelled.
 *
 *   cd packages/pi-browser && npx tsx test/trace-proxy.ts --listen 8094 --target 8093 --out <dir>
 *   SUITE_TRACE=<dir> (same dir) LLAMA_BASE_URL=http://127.0.0.1:8094 MODEL=llama.cpp/<id> pnpm eval:browser <task>
 *
 * Output: <dir>/requests.jsonl, truncated when the proxy starts. The task and run of each record come from <dir>/label.json, which suite.ts
 * rewrites before every run when SUITE_TRACE is set (the proxy re-reads it per request). Analyze with trace-report.ts.
 * Privacy: records contain full page text, tool output, the user's goal and the model's reasoning. Keep the trace dir out of shared places.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { join } from "node:path";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
function port(name: string, fallback: string): number {
  const raw = arg(name, fallback);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`--${name} must be a TCP port number, got "${raw}"`);
  return n;
}
const listen = port("listen", "8094");
const target = port("target", "8093");
const out = arg("out", process.env.SUITE_TRACE ?? "");
if (!out) throw new Error("--out <dir> (or SUITE_TRACE) is required");
mkdirSync(out, { recursive: true });
const file = join(out, "requests.jsonl");
writeFileSync(file, ""); // each proxy start replaces the previous log in this dir
let seq = 0;

function label(): { task?: string; run?: number } {
  try {
    return JSON.parse(readFileSync(join(out, "label.json"), "utf8"));
  } catch {
    return {};
  }
}

interface Acc {
  text: string;
  reasoning: string;
  toolCalls: { id?: string; name: string; arguments: string }[];
  finishReason?: string;
  usage?: unknown;
  timings?: unknown;
  model?: string;
}

/** Folds one chat-completion chunk (streamed delta or full message) into the accumulator. */
function fold(acc: Acc, chunk: any) {
  if (chunk.model) acc.model = chunk.model;
  if (chunk.usage) acc.usage = chunk.usage;
  if (chunk.timings) acc.timings = chunk.timings;
  for (const choice of chunk.choices ?? []) {
    if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    const d = choice.delta ?? choice.message ?? {};
    if (typeof d.content === "string") acc.text += d.content;
    if (typeof d.reasoning_content === "string") acc.reasoning += d.reasoning_content;
    for (const [n, tc] of (d.tool_calls ?? []).entries()) {
      const idx = tc.index ?? n;
      const cur = (acc.toolCalls[idx] ??= { name: "", arguments: "" });
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.arguments += tc.function.arguments;
    }
  }
}

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("error", () => res.destroy());
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const isChat = req.method === "POST" && (req.url ?? "").split("?")[0] === "/v1/chat/completions";
    const started = Date.now();
    const headers = { ...req.headers, host: `127.0.0.1:${target}`, "accept-encoding": "identity" };
    const acc: Acc = { text: "", reasoning: "", toolCalls: [] };
    let upRes: { statusCode?: number } | undefined;
    let raw = "";
    let buffer = "";
    let done = false;

    /** Writes the record once: on upstream end, upstream error, or client abort. */
    const finish = (aborted: boolean, error?: string) => {
      if (done) return;
      done = true;
      if (!isChat) return;
      const streamed = raw.trimStart().startsWith("data:");
      if (!streamed) {
        try {
          fold(acc, JSON.parse(raw));
        } catch {}
      }
      let request: unknown;
      try {
        request = JSON.parse(body.toString("utf8"));
      } catch {
        request = body.toString("utf8");
      }
      const record = {
        seq: ++seq,
        at: new Date(started).toISOString(),
        ...label(),
        status: upRes?.statusCode,
        streamed,
        aborted,
        ...(error ? { error } : {}),
        wallMs: Date.now() - started,
        request,
        response: { text: acc.text, reasoning: acc.reasoning, toolCalls: acc.toolCalls.filter(Boolean), finishReason: acc.finishReason, model: acc.model },
        usage: acc.usage,
        timings: acc.timings,
        ...(upRes?.statusCode && upRes.statusCode >= 400 ? { rawError: raw.slice(0, 2000) } : {}),
      };
      appendFileSync(file, `${JSON.stringify(record)}\n`);
    };

    const up = httpRequest({ host: "127.0.0.1", port: target, path: req.url, method: req.method, headers }, (r) => {
      upRes = r;
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.on("data", (c: Buffer) => {
        res.write(c);
        if (!isChat) return;
        const s = c.toString("utf8");
        raw += s;
        buffer += s;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
          try {
            fold(acc, JSON.parse(line.slice(5)));
          } catch {}
        }
      });
      r.on("end", () => {
        res.end();
        finish(false);
      });
      r.on("error", (e) => {
        res.destroy();
        finish(false, String(e));
      });
    });
    up.on("error", (e) => {
      // Once headers are out we cannot send a 502; cut the connection so the client sees the failure.
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) res.writeHead(502).end(String(e));
      finish(false, String(e));
    });
    // Client went away before the response finished: cancel the upstream request and still log what arrived.
    res.on("close", () => {
      if (res.writableFinished) return;
      up.destroy();
      finish(true);
    });
    up.end(body);
  });
}).listen(listen, "127.0.0.1", () => console.log(`trace-proxy 127.0.0.1:${listen} -> 127.0.0.1:${target}, writing ${file}`));
