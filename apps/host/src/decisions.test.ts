import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { DecisionEntry } from "@pista/protocol";
import { liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir, root } = setupHome("decisions");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { DecisionLog, MAX_DECISIONS } = await import("./decisions.ts");

/** A session that Pi will write to disk (it only does so once there is a conversation). */
function sessionWithFile() {
  const sm = SessionManager.create(projectDir, join(root, "sessions"));
  sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  return sm;
}

test("record assigns id and ts, appends, emits and persists one custom entry per decision", () => {
  const sm = SessionManager.inMemory(projectDir);
  const emitted: DecisionEntry[] = [];
  const log = new DecisionLog(sm, (d) => emitted.push(d));
  const a = log.record({ kind: "plan_change", summary: "Plan set: 2 steps", reason: "why" });
  const b = log.record({ kind: "goal_verdict", summary: "Judge: met, progress yes", data: { turn: 1 } });
  assert.ok(a.id && b.id && a.id !== b.id);
  assert.ok(a.ts > 0 && b.ts >= a.ts);
  assert.deepEqual(log.list(), [a, b]);
  assert.deepEqual(emitted, [a, b]);
  const stored = sm.getEntries().filter((e) => e.type === "custom" && e.customType === "pista.decision");
  assert.deepEqual(stored.map((e) => (e as unknown as { data: DecisionEntry }).data), [a, b]);
});

test("restore after reopening the session file returns the same entries in order", () => {
  const sm = sessionWithFile();
  const log = new DecisionLog(sm, () => {});
  const written = [1, 2, 3].map((n) => log.record({ kind: "goal_action", summary: `step ${n}`, data: { n } }));
  const file = sm.getSessionFile()!;

  const fresh = new DecisionLog(SessionManager.open(file), () => {});
  assert.deepEqual(fresh.list(), []);
  fresh.restore();
  assert.deepEqual(fresh.list(), written);
});

test("the in-memory list is capped at the newest entries while the session keeps all of them", () => {
  const sm = SessionManager.inMemory(projectDir);
  const log = new DecisionLog(sm, () => {});
  for (let i = 0; i < MAX_DECISIONS + 5; i++) log.record({ kind: "goal_action", summary: `d${i}` });
  const list = log.list();
  assert.equal(list.length, MAX_DECISIONS);
  assert.equal(list[0]!.summary, "d5");
  assert.equal(list.at(-1)!.summary, `d${MAX_DECISIONS + 4}`);
  const stored = sm.getEntries().filter((e) => e.type === "custom");
  assert.equal(stored.length, MAX_DECISIONS + 5);

  const restored = new DecisionLog(sm, () => {});
  restored.restore();
  assert.equal(restored.list().length, MAX_DECISIONS);
  assert.equal(restored.list()[0]!.summary, "d5");
});

test("a thread's decisions reach the UI as events and in the snapshot, and survive a restart", async () => {
  const { Hub } = await import("./hub.ts");
  const events: unknown[] = [];
  const hub = new Hub();
  const emit = hub.emit.bind(hub);
  hub.emit = ((msg: { type: string; event?: { type: string } }) => {
    if (msg.type === "thread.event" && msg.event?.type === "decision_logged") events.push(msg.event);
    return emit(msg as never);
  }) as typeof hub.emit;
  const { manager: first, models, project } = await makeManager({ projectDir, hub, dispose: false });
  const created = await first.create(project.id);
  assert.deepEqual(created.decisions, []);
  const id = created.summary.id;
  const thread = liveOf<{ decisions: InstanceType<typeof DecisionLog>; session: { sessionManager: { appendMessage(m: unknown): void } } }>(first).get(id)!;
  thread.session.sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  const entry = thread.decisions.record({ kind: "replan", summary: "x" });
  assert.equal(events.length, 1);
  assert.deepEqual((await first.open(id)).decisions, [entry]);
  first.dispose();

  const { manager: second } = await makeManager({ models });
  await second.list();
  assert.deepEqual((await second.open(id)).decisions, [entry]);
});
