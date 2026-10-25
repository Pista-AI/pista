import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ThreadManager } from "./threads.ts";
import { liveOf as liveMap, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("child");
const { manager, store, models, project } = await makeManager({ projectDir });

type Live = { summary: object; session: { sessionManager: { appendMessage(m: unknown): void } } };
const liveOf = (m: ThreadManager) => liveMap<Live>(m);

/** Pi writes a session file only once it has a conversation; give a thread one so it survives a restart. */
function persist(m: ThreadManager, id: string) {
  liveOf(m).get(id)!.session.sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
}

const blocked = async (m: ThreadManager, id: string, toolName: string) => {
  const { session } = await m.continueChild(id);
  const result = await session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: `t-${toolName}`, toolName, input: {} } as never);
  return result?.block === true;
};

test("spawnChild lists the child with parentId and role, and restricts its tools", async () => {
  const { summary: parent } = await manager.create(project.id);
  const childId = await manager.spawnChild(parent.id, { role: "explorer" });

  const child = (await manager.list()).find((t) => t.id === childId);
  assert.equal(child?.parentId, parent.id);
  assert.equal(child?.role, "explorer");
  assert.equal(child?.projectId, project.id);
  assert.deepEqual(store.getThreadMeta(childId), { parentId: parent.id, role: "explorer" });

  const live = await manager.continueChild(childId);
  assert.deepEqual([...live.session.getActiveToolNames()].sort(), ["find", "grep", "ls", "read"]);
  assert.equal((await manager.continueChild(childId)).session, live.session);
  await assert.rejects(manager.continueChild(parent.id), /Not a child thread/);
});

test("the role gate refuses write, edit and bash and allows read in a live child session", async () => {
  const { summary: parent } = await manager.create(project.id);
  const childId = await manager.spawnChild(parent.id, { role: "explorer" });
  for (const tool of ["write", "edit", "bash"]) assert.ok(await blocked(manager, childId, tool), tool);
  assert.ok(!(await blocked(manager, childId, "read")));
});

test("spawnChild rejects unknown roles, including prototype keys", async () => {
  const { summary: parent } = await manager.create(project.id);
  for (const role of ["bogus", "__proto__", "toString", "constructor"]) {
    await assert.rejects(manager.spawnChild(parent.id, { role: role as never }), /Unknown agent role/, role);
  }
});

test("spawnChild takes no cwd: the child uses the project path as the parent does", async () => {
  const { summary: parent } = await manager.create(project.id);
  const childId = await manager.spawnChild(parent.id, { role: "reviewer" });
  assert.equal((await manager.continueChild(childId)).session.sessionManager.getCwd(), project.path);
});

test("children and their role survive a host restart", async () => {
  const { summary: parent } = await manager.create(project.id);
  persist(manager, parent.id);
  const childId = await manager.spawnChild(parent.id, { role: "explorer" });
  persist(manager, childId);
  manager.dispose();

  const { manager: manager2 } = await makeManager({ models, dispose: false });
  try {
    const child = (await manager2.list()).find((t) => t.id === childId);
    assert.equal(child?.parentId, parent.id);
    assert.equal(child?.role, "explorer");
    assert.equal(child?.loaded, false);

    const live = await manager2.continueChild(childId);
    assert.deepEqual([...live.session.getActiveToolNames()].sort(), ["find", "grep", "ls", "read"]);
    for (const tool of ["write", "edit", "bash"]) assert.ok(await blocked(manager2, childId, tool), tool);
    assert.ok(!(await blocked(manager2, childId, "read")));
  } finally {
    manager2.dispose();
  }
});

test("archiving a parent removes its unloaded children and their threadMeta", async () => {
  const { summary: parent } = await manager.create(project.id);
  persist(manager, parent.id);
  const childId = await manager.spawnChild(parent.id, { role: "explorer" });
  persist(manager, childId);
  manager.dispose();

  const { manager: manager2, store: store2 } = await makeManager({ models, dispose: false });
  try {
    assert.ok((await manager2.list()).some((t) => t.id === childId && !t.loaded));
    await manager2.archive(parent.id);
    const ids = (await manager2.list()).map((t) => t.id);
    for (const id of [parent.id, childId]) {
      assert.ok(!ids.includes(id), id);
      assert.ok(store2.isArchived(id), id);
      assert.equal(store2.getThreadMeta(id), undefined, id);
    }
  } finally {
    manager2.dispose();
  }
});

test("archiving the parent archives its live children", async () => {
  const { summary: parent } = await manager.create(project.id);
  const a = await manager.spawnChild(parent.id, { role: "explorer" });
  const b = await manager.spawnChild(parent.id, { role: "reviewer" });
  await manager.archive(parent.id);
  const ids = (await manager.list()).map((t) => t.id);
  for (const id of [parent.id, a, b]) {
    assert.ok(!ids.includes(id));
    assert.ok(store.isArchived(id));
    assert.equal(store.getThreadMeta(id), undefined);
  }
});

test("archive terminates on inconsistent parent links (A -> B -> A)", async () => {
  const { summary: a } = await manager.create(project.id);
  const b = await manager.spawnChild(a.id, { role: "explorer" });
  const live = liveOf(manager);
  live.get(a.id)!.summary = { ...live.get(a.id)!.summary, parentId: b };
  await manager.archive(a.id);
  const ids = (await manager.list()).map((t) => t.id);
  assert.ok(!ids.includes(a.id) && !ids.includes(b));
  assert.ok(store.isArchived(a.id) && store.isArchived(b));
});

test("reloadIdle keeps children of a streaming parent, and never-prompted children", async () => {
  const live = liveOf(manager);
  const { summary: parent } = await manager.create(project.id);
  const childId = await manager.spawnChild(parent.id, { role: "explorer" });
  const parentSession = live.get(parent.id)!.session;
  Object.defineProperty(parentSession, "isStreaming", { get: () => true, configurable: true });
  try {
    await manager.reloadIdle();
    assert.ok(live.has(parent.id), "streaming parent stays");
    assert.ok(live.has(childId), "child of a streaming parent stays");
  } finally {
    delete (parentSession as { isStreaming?: boolean }).isStreaming;
  }
  await manager.reloadIdle();
  assert.ok(live.has(childId), "a child that was never prompted has no file, so it stays loaded");
});

test("reloadIdle(projectId) drops only that project's idle threads and keeps its streaming ones", async () => {
  const live = liveOf(manager);
  const other = store.addProject(mkdtempSync(join(tmpdir(), "pista-other-")));
  const { summary: idle } = await manager.create(project.id);
  const { summary: streaming } = await manager.create(project.id);
  const { summary: elsewhere } = await manager.create(other.id);
  const session = live.get(streaming.id)!.session;
  Object.defineProperty(session, "isStreaming", { get: () => true, configurable: true });
  try {
    await manager.reloadIdle(project.id);
    assert.ok(!live.has(idle.id), "idle thread of the scoped project is dropped");
    assert.ok(live.has(streaming.id), "streaming thread of the scoped project stays");
    assert.ok(live.has(elsewhere.id), "idle thread of another project stays");
  } finally {
    delete (session as { isStreaming?: boolean }).isStreaming;
  }
  await manager.reloadIdle();
  assert.ok(!live.has(elsewhere.id), "unscoped reload drops it");
});
