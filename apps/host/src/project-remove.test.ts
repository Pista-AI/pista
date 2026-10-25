import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import type { HostEvent } from "@pista/protocol";
import type { ThreadManager } from "./threads.ts";
import { liveOf as liveMap, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("project-remove");
const { manager, store, hub, project } = await makeManager({ projectDir });

type Live = { session: { sessionManager: { appendMessage(m: unknown): void } } };
const liveOf = (m: ThreadManager) => liveMap<Live>(m);

test("removing a project drops it and its threads but leaves files; re-adding brings the threads back", async () => {
  const { summary } = await manager.create(project.id);
  // Pi writes a session file only once there is a conversation.
  liveOf(manager).get(summary.id)!.session.sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  assert.ok((await manager.list()).some((t) => t.id === summary.id));

  const events: HostEvent[] = [];
  const emit = hub.emit.bind(hub);
  hub.emit = (e) => (events.push(e), emit(e));
  await manager.removeProject(project.id);

  assert.ok(!store.projects.some((p) => p.id === project.id));
  assert.ok(!(await manager.list()).some((t) => t.id === summary.id));
  assert.equal(liveOf(manager).size, 0);
  assert.ok(existsSync(projectDir));
  assert.ok(events.some((e) => e.type === "thread.removed" && e.threadId === summary.id));
  assert.ok(events.some((e) => e.type === "projects.changed"));

  const readded = store.addProject(projectDir);
  assert.equal(readded.id, project.id);
  assert.ok((await manager.list()).some((t) => t.id === summary.id && t.projectId === project.id));
});

test("removing an unknown project throws and changes nothing", async () => {
  await assert.rejects(manager.removeProject("nope"), /Unknown project/);
});
