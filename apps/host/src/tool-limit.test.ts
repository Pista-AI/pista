import assert from "node:assert/strict";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("tool-limit-test", { cleanup: "exit" });
const { toolLimitExtension } = await import("./extensions.ts");
const { Hub } = await import("./hub.ts");
const { makeManager } = await import("./test-helpers.ts");

let resolvedOf: () => unknown[] = () => [];
type Handler = (event: unknown, ctx: unknown) => Promise<{ block?: boolean; terminate?: boolean } | undefined>;

function window(hub: InstanceType<typeof Hub>, closed: { close?: () => void } = {}) {
  const frames: { event: Record<string, unknown> }[] = [];
  hub.add({ readyState: 1, OPEN: 1, on: (_: string, h: () => void) => (closed.close = h), send: (f: string) => frames.push(JSON.parse(f)) } as never);
  frames.length = 0;
  resolvedOf = () => frames.filter((f) => f.event.type === "approval.resolved").map((f) => f.event.approvalId);
  return () => frames.filter((f) => f.event.type === "approval.request").map((f) => f.event);
}

/** A gate over a bare counter, mirroring what the thread manager provides. */
function setup(limit: number, used: number) {
  const hub = new Hub();
  const closed: { close?: () => void } = {};
  const requests = window(hub, closed);
  const resolved = resolvedOf;
  const gone = new AbortController();
  const state = { limit, used, extra: 0, stopped: 0 };
  const gate = {
    reached: () => state.used >= state.limit + state.extra,
    used: () => state.used,
    more: () => state.limit,
    extend: () => void (state.extra += state.limit),
    stop: () => void state.stopped++,
    signal: gone.signal,
    close: () => gone.abort(),
  };
  let handler!: Handler;
  (toolLimitExtension(hub, { threadId: "t1" } as never, gate) as unknown as { factory: (pi: unknown) => void }).factory({ on: (_: string, h: Handler) => (handler = h) });
  return { hub, requests, state, call: (runSignal?: AbortSignal) => handler({}, { signal: runSignal }), closed, gone, resolved };
}

test("under the limit nothing is asked", async () => {
  const s = setup(5, 4);
  assert.equal(await s.call(), undefined);
  assert.equal(s.requests().length, 0);
});

test("Continue raises the budget by another limit and the call proceeds", async () => {
  const s = setup(5, 5);
  const result = s.call();
  const [req] = s.requests();
  assert.deepEqual(req!.toolLimit, { used: 5, more: 5 });
  s.hub.settle(req!.approvalId as string, { allow: true });
  assert.equal(await result, undefined);
  assert.equal(s.state.extra, 5);
  assert.equal(s.state.stopped, 0);
});

test("Stop blocks the call, terminates and stops the run", async () => {
  const s = setup(5, 5);
  const result = s.call();
  s.hub.settle(s.requests()[0]!.approvalId as string, { allow: false });
  const r = await result;
  assert.equal(r?.block, true);
  assert.equal(r?.terminate, true);
  assert.equal(s.state.stopped, 1);
});

test("parallel calls share one question", async () => {
  const s = setup(5, 5);
  const results = [s.call(), s.call()];
  assert.equal(s.requests().length, 1);
  s.hub.settle(s.requests()[0]!.approvalId as string, { allow: true });
  await Promise.all(results);
  assert.equal(s.state.extra, 5, "extended once");
});

test("an aborted run withdraws the card and stops; a late Continue does nothing", async () => {
  const s = setup(5, 5);
  const run = new AbortController();
  const result = s.call(run.signal);
  const id = s.requests()[0]!.approvalId;
  run.abort();
  assert.equal((await result)?.block, true);
  assert.deepEqual(s.resolved(), [id]);
  s.hub.settle(id as string, { allow: true });
  assert.equal(s.state.extra, 0);
});

test("a thread going away withdraws the card", async () => {
  const s = setup(5, 5);
  const result = s.call();
  s.gone.abort();
  assert.equal((await result)?.block, true);
  assert.equal(s.resolved().length, 1);
});

test("the last window closing settles the card as Stop right away", async () => {
  const s = setup(5, 5);
  const result = s.call();
  s.closed.close!();
  const r = await result;
  assert.equal(r?.terminate, true);
  assert.equal(s.state.stopped, 1);
});

test("a sub-agent (no tool-limit gate) is stopped at the limit even with a window connected; a top-level thread is not", async () => {
  const hub = new Hub();
  const { manager } = await makeManager({ hub });
  window(hub);
  const aborted: string[] = [];
  const fake = (toolLimit?: unknown) =>
    ({ maxToolCalls: 1, toolLimit, guard: { lastError: "", streak: 0, toolCalls: 0, extra: 0, stopped: false }, summary: { title: "t" }, session: { abort: async () => void aborted.push("x") } }) as never;
  const end = { toolName: "read", isError: false };
  const child = fake();
  (manager as never as { guardRun(t: unknown, e: unknown): void }).guardRun(child, end);
  assert.equal((child as { guard: { stopped: boolean } }).guard.stopped, true);
  assert.equal(aborted.length, 1);
  const top = fake();
  (top as { toolLimit: unknown }).toolLimit = manager.toolLimitGate(() => top);
  (manager as never as { guardRun(t: unknown, e: unknown): void }).guardRun(top, end);
  assert.equal((top as { guard: { stopped: boolean } }).guard.stopped, false);
  assert.equal(aborted.length, 1);
});

test("with no window connected the gate is not reached, so the run still stops at the limit", async () => {
  const hub = new Hub();
  const { manager } = await makeManager({ hub });
  const thread = { maxToolCalls: 3, guard: { toolCalls: 3, extra: 0, stopped: false } } as never;
  assert.equal(manager.toolLimitGate(() => thread).reached(), false);
  window(hub);
  assert.equal(manager.toolLimitGate(() => thread).reached(), true);
});
