import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BrowserDriver } from "../src/driver.ts";
import { registerBrowserTools } from "../src/tools.ts";
import { createTracer, describeResult, redactUrl, traceTools, type TraceLine } from "../src/trace.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-trace-"));
const day = () => new Date().toISOString().slice(0, 10);
const read = (dir: string, d = day()) => readFileSync(join(dir, "browser-traces", `${d}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("the tracer writes schema lines and writes nothing when off", () => {
  const dir = tmp();
  const line: TraceLine = { ts: "2026-10-21T06:35:40.123Z", threadId: "t1", tool: "browser_click", url: "example.com/x", ms: 5, chars: 10, elements: 4, mode: "delta", cdp: 3, isError: false };
  createTracer(dir, {})!(line);
  createTracer(dir, {})!({ ...line, isError: true, error: "timeout" });
  assert.deepEqual(read(dir, "2026-10-21"), [line, { ...line, isError: true, error: "timeout" }]);
  const off = tmp();
  assert.equal(createTracer(off, { PI_BROWSER_TRACE_DIR: "OFF" }), undefined);
  assert.equal(createTracer(undefined, {}), undefined);
  assert.equal(createTracer(off, { PI_BROWSER_TRACE_DIR: join(off, "other") }) !== undefined, true); // the env overrides the option
  assert.deepEqual(readdirSync(off), []);
});

test("an unwritable directory never throws and warns at most once", () => {
  const file = join(tmp(), "plain-file");
  writeFileSync(file, "x");
  const warns: unknown[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(a);
  try {
    const write = createTracer(join(file, "sub"), {})!;
    const line: TraceLine = { ts: "2026-10-21T00:00:00.000Z", tool: "browser_click", ms: 1, chars: 1, isError: false };
    assert.doesNotThrow(() => (write(line), write(line)));
    assert.equal(warns.length, 1);
  } finally {
    console.warn = original;
  }
});

test("browser tools write private, correctly shaped lines", async () => {
  assert.equal(redactUrl("https://user:pw@example.com/a/b?q=secret#frag"), "example.com/a/b");
  assert.equal(redactUrl("data:text/html,<p>hi</p>"), undefined);
  assert.equal(redactUrl("not a url"), undefined);
  assert.deepEqual(describeResult("42 interactive elements. top\nrest"), { chars: 33, elements: 42, mode: "full" });
  const delta = "Page changed (delta since last view):\n+ [e3] button\n~ [e4] link\n- [e5] link\n40 other elements unchanged; call browser_snapshot.";
  assert.deepEqual(describeResult(delta), { chars: delta.length, elements: 43, mode: "delta" });
  assert.deepEqual(describeResult("plain page text"), { chars: 15 });
  const capped = `${delta}\n120 interactive elements listed (capped).`;
  assert.equal(describeResult(capped).mode, "delta");

  const dir = tmp();
  let trips = 0;
  const driver = {
    state: async () => ({ url: "https://shop.example/cart?email=a@b.c#top", title: "Secret title", loading: false }),
    evaluate: async (script: string) => (trips++, script.includes("fail") ? Promise.reject(new Error("Timed out waiting for SECRET")) : "secret value"),
    stats: () => ({ roundTrips: trips }),
  } as unknown as BrowserDriver;
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver, { keepPageViews: 0, traceDir: dir, threadId: "thr-1" });
  await tools.get("browser_eval")!.execute("1", { script: "document.title" });
  await assert.rejects(tools.get("browser_eval")!.execute("2", { script: "fail" }));
  const [ok, bad] = read(dir);
  assert.equal(ok.tool, "browser_eval");
  assert.equal(ok.threadId, "thr-1");
  assert.equal(ok.url, "shop.example/cart");
  assert.equal(ok.cdp, 1);
  assert.equal(ok.isError, false);
  assert.ok(ok.chars > 0 && typeof ok.ms === "number");
  assert.deepEqual([bad.isError, bad.error], [true, "timeout"]);
  const raw = readFileSync(join(dir, "browser-traces", `${day()}.jsonl`), "utf8");
  for (const secret of ["Secret title", "secret value", "document.title", "SECRET", "email=", "#top"]) assert.ok(!raw.includes(secret), secret);
});

test("a failure while tracing a finished call still returns the tool result unchanged", async () => {
  const dir = tmp();
  const registered = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  const { pi } = traceTools({ registerTool: (t: { name: string }) => registered.set(t.name, t as never) } as never, async () => ({}) as BrowserDriver, { traceDir: dir });
  const odd = { content: "not an array" };
  pi.registerTool({ name: "browser_odd", execute: async () => odd } as never);
  assert.equal(await registered.get("browser_odd")!.execute("1", {}), odd);
  assert.deepEqual(readdirSync(dir), []);
});
