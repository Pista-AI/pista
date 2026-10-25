import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent, Plan } from "@pista/protocol";
import { liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("plan-threads");
const { Hub } = await import("./hub.ts");
const { applyPlanOp } = await import("./plan.ts");

type Live = { session: { sessionManager: { appendMessage(m: unknown): void } } };
type Internals = { setPlan(thread: unknown, plan: Plan): void };

test("the plan survives a restart and reaches the UI as an event and in the snapshot", async () => {
  const events: AgentEvent[] = [];
  const hub = new Hub();
  const emit = hub.emit.bind(hub);
  hub.emit = ((msg: { type: string; event?: AgentEvent }) => {
    if (msg.type === "thread.event" && msg.event) events.push(msg.event);
    return emit(msg as never);
  }) as typeof hub.emit;

  const { manager: first, models, project } = await makeManager({ projectDir, hub, dispose: false });
  const created = await first.create(project.id);
  assert.equal(created.plan, undefined);
  const id = created.summary.id;
  const internals = first as unknown as Internals;
  const thread = liveOf<Live>(first).get(id)!;
  // Pi writes a session file only once it has a conversation.
  thread.session.sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });

  const { plan } = applyPlanOp(undefined, { op: "set", steps: [{ title: "Read" }, { title: "Write", dependsOn: ["s1"] }] });
  internals.setPlan(thread, plan);
  assert.deepEqual(events.filter((e) => e.type === "plan_updated"), [{ type: "plan_updated", plan }]);
  assert.deepEqual((await first.open(id)).plan, plan);
  first.dispose();

  const { manager: second } = await makeManager({ models });
  await second.list();
  assert.deepEqual((await second.open(id)).plan, plan);
});
