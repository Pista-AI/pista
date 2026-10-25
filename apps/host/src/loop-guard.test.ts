import assert from "node:assert/strict";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("loop-guard-test", { cleanup: "exit" });
const { loopGuardExtension } = await import("./extensions.ts");

type Handler = (event: any, ctx: any) => any;
const LOCAL = { provider: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" };
const REMOTE = { provider: "openai", baseUrl: "https://api.openai.com/v1" };
const store = { config: { localServers: [] } } as never;

/** Loads the extension against a fake Pi and returns a way to fire its hooks. */
function guard(model: typeof LOCAL | typeof REMOTE) {
  const handlers = new Map<string, Handler>();
  const ext = loopGuardExtension(store);
  (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (name: string, h: Handler) => handlers.set(name, h) });
  return {
    start: () => handlers.get("agent_start")!({}, { model }),
    call: (toolName: string, input: unknown = {}) => handlers.get("tool_call")!({ toolName, input }, { model }),
  };
}

test("four blocked calls with varying arguments pause tool calls without terminating", () => {
  const g = guard(REMOTE);
  g.start();
  // Two keys alternating: each key's third call is blocked, the fourth block pauses the run.
  const results = [];
  for (let i = 0; i < 4; i++) {
    for (const key of ["a", "b"]) results.push(g.call("browser_click", { key }));
  }
  results.push(g.call("browser_click", { key: "c" }));
  const blocked = results.filter((r) => r?.block);
  assert.equal(blocked.length, 5);
  assert.ok(blocked.every((r) => r.terminate === undefined));
  assert.match(blocked[3].reason, /Stopped: you keep repeating tool calls\. Tool calls are paused for this turn; answer the user now with what you found/);
  assert.match(blocked[4].reason, /^Tool calls are paused for this turn; answer the user now\.$/);
  assert.ok(!/paused/.test(blocked[0].reason));
});

test("once paused, every further call is blocked until the next prompt", () => {
  const g = guard(REMOTE);
  g.start();
  for (let i = 0; i < 5; i++) g.call("x");
  for (const tool of ["x", "y", "browser_scroll", "browser_read"]) {
    const r = g.call(tool, { fresh: true });
    assert.equal(r.block, true);
    assert.equal(r.terminate, undefined);
    assert.match(r.reason, /paused for this turn/);
  }
  g.start();
  assert.equal(g.call("y"), undefined);
});

test("five identical calls pause instead of terminating", () => {
  const g = guard(REMOTE);
  g.start();
  const results = [1, 2, 3, 4, 5].map(() => g.call("z"));
  assert.equal(results[4].block, true);
  assert.equal(results[4].terminate, undefined);
  assert.match(results[4].reason, /Stopped: z was called 5 times/);
  assert.match(g.call("other").reason, /paused/);
});

test("the blocked counter resets on a new prompt", () => {
  const g = guard(REMOTE);
  g.start();
  for (let i = 0; i < 3; i++) g.call("x");
  g.call("x"); // second blocked call
  g.start();
  for (let i = 0; i < 3; i++) g.call("y");
  assert.equal(g.call("y")?.reason.startsWith("Stopped"), false);
  assert.equal(g.call("w"), undefined);
});

test("a read after navigating to another page is not a repeat; the same read on the same page is", () => {
  const g = guard(REMOTE);
  g.start();
  for (let page = 0; page < 6; page++) {
    assert.equal(g.call("browser_navigate", { url: `https://example.com/${page}` }), undefined);
    assert.equal(g.call("browser_read", {}), undefined);
    assert.equal(g.call("browser_snapshot", {}), undefined);
  }
  // Same page, same read: the third identical call is blocked.
  assert.equal(g.call("browser_read", {}), undefined);
  assert.equal(g.call("browser_read", {})?.block, true);
});

test("a click or key press also starts a new page epoch", () => {
  const g = guard(REMOTE);
  g.start();
  for (const mutate of ["browser_click", "browser_type", "browser_press", "browser_select", "browser_back", "browser_eval"]) {
    g.call("browser_read", {});
    g.call(mutate, { k: mutate });
  }
  // Seven reads of {} in seven epochs: none blocked, nothing paused.
  assert.equal(g.call("browser_read", {}), undefined);
});

test("non-browser tools keep the plain key across page changes", () => {
  const g = guard(REMOTE);
  g.start();
  g.call("grep", { q: 1 });
  g.call("browser_navigate", { url: "a" });
  g.call("grep", { q: 1 });
  g.call("browser_navigate", { url: "b" });
  assert.equal(g.call("grep", { q: 1 })?.block, true);
});

test("a local model is paused at 40 tool calls, a remote one is not", () => {
  const local = guard(LOCAL);
  const remote = guard(REMOTE);
  local.start();
  remote.start();
  for (let i = 1; i <= 39; i++) {
    assert.equal(local.call("t", { i }), undefined);
    assert.equal(remote.call("t", { i }), undefined);
  }
  const stop = local.call("t", { i: 40 });
  assert.equal(stop.block, true);
  assert.equal(stop.terminate, undefined);
  assert.match(stop.reason, /40 tool calls/);
  assert.match(local.call("t", { i: 41 }).reason, /paused/);
  assert.equal(remote.call("t", { i: 40 }), undefined);
  assert.equal(remote.call("t", { i: 41 }), undefined);
});

test("browser_scroll is exempt from every cap", () => {
  const g = guard(LOCAL);
  g.start();
  for (let i = 0; i < 100; i++) assert.equal(g.call("browser_scroll", { dy: 100 }), undefined);
  assert.equal(g.call("t", { i: 1 }), undefined);
});
