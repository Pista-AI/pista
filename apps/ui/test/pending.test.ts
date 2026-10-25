import assert from "node:assert/strict";
import { test } from "node:test";
import { adoptPending } from "../src/lib/pending.ts";

const user = (text: string) => ({ role: "user" as const, content: text, timestamp: 1 });

test("echo replaces the pending message in place", () => {
  const optimistic = user("hi");
  const echo = user("hi");
  const out = adoptPending([user("earlier"), optimistic], [optimistic], echo);
  assert.ok(out);
  assert.equal(out.messages.length, 2);
  assert.equal(out.messages[1], echo);
  assert.equal(out.pending.length, 0);
});

test("non-user messages and empty pending are not adopted", () => {
  const optimistic = user("hi");
  const assistant = { role: "assistant" } as never;
  assert.equal(adoptPending([optimistic], [optimistic], assistant), undefined);
  assert.equal(adoptPending([], [], user("hi")), undefined);
});

test("only a matching text is adopted", () => {
  const optimistic = user("hi");
  assert.equal(adoptPending([optimistic], [optimistic], user("other")), undefined);
});

test("reducer: settle without echo clears pending state; matching echo does not duplicate", async () => {
  // The store module touches browser globals at import time.
  Object.assign(globalThis, { window: globalThis, location: { protocol: "http:", host: "localhost", search: "" }, localStorage: { getItem: () => null, setItem() {} } });
  const { reduceThread } = await import("../src/lib/store.ts");
  const optimistic = user("hi");
  const base = { messages: [optimistic], pendingUser: [optimistic], isStreaming: true, turnStartedAt: 1, toolRuns: {}, decisions: [] } as never;
  const settled = reduceThread(base, { type: "agent_settled" });
  assert.equal(settled.isStreaming, false);
  assert.deepEqual(settled.pendingUser, []);
  assert.equal(settled.messages.length, 1);

  const echo = user("hi");
  const started = reduceThread(base, { type: "message_start", message: echo } as never);
  assert.equal(started.messages.length, 1);
  assert.deepEqual(started.pendingUser, []);
  const ended = reduceThread(started, { type: "message_end", message: echo } as never);
  assert.equal(ended.messages.length, 1);
  const endOnly = reduceThread(base, { type: "message_end", message: echo } as never);
  assert.equal(endOnly.messages.length, 1);
  assert.deepEqual(endOnly.pendingUser, []);
});

test("reducer: new thread emits a system message before the user echo; no duplicate, echo stays last", async () => {
  Object.assign(globalThis, { window: globalThis, location: { protocol: "http:", host: "localhost", search: "" }, localStorage: { getItem: () => null, setItem() {} } });
  const { reduceThread } = await import("../src/lib/store.ts");
  const optimistic = user("hi");
  const system = { role: "system", content: "" } as never;
  let view = { messages: [optimistic], pendingUser: [optimistic], isStreaming: true, toolRuns: {}, decisions: [] } as never;
  const echo = { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 2 } as never;
  for (const e of [
    { type: "message_start", message: system },
    { type: "message_end", message: system },
    { type: "message_start", message: echo },
    { type: "message_end", message: echo },
  ]) view = reduceThread(view, e as never);
  const roles = (view as { messages: { role: string }[] }).messages.map((m) => m.role);
  assert.deepEqual(roles, ["system", "user"]);
  assert.deepEqual((view as { pendingUser: unknown[] }).pendingUser, []);
});
