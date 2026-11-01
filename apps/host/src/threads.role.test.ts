import assert from "node:assert/strict";
import { test } from "node:test";
import { availableRoles, ROLES } from "./roles.ts";
import { liveOf as liveMap, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("toplevel-role");
const { manager, store, project } = await makeManager({ projectDir });
type Live = { session: { getActiveToolNames(): string[]; systemPrompt: string; extensionRunner: { emitToolCall(e: unknown): Promise<{ block?: boolean } | undefined> } } };
const metaIds = () => Object.keys((store as unknown as { state: { threadMeta: object } }).state.threadMeta).sort();

test("a top-level thread can run as invoice-fetch: prompt, tools and gate apply, and it is not a sub-agent", async () => {
  const { summary } = await manager.create(project.id, "invoice-fetch");
  assert.equal(summary.parentId, undefined);
  assert.deepEqual(store.getThreadMeta(summary.id), { role: "invoice-fetch" });
  const { session } = liveMap<Live>(manager).get(summary.id)!;
  assert.match(session.systemPrompt, /Never open, log in to, or ask the owner to log in to a bank/);
  const tools = session.getActiveToolNames();
  for (const t of ["read", "write", "browser_navigate", "browser_eval", "browser_login"]) assert.ok(tools.includes(t), t);
  assert.ok(!tools.includes("bash"));
  assert.ok(!tools.includes("agent"));
  assert.equal((await session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "x", toolName: "edit", input: {} }))?.block, true);
});

test("an unknown role is rejected and leaves no thread meta behind", async () => {
  const before = metaIds();
  for (const role of ["bogus", "__proto__", "toString"]) await assert.rejects(manager.create(project.id, role), /Unknown agent role/, role);
  assert.deepEqual(metaIds(), before);
});

test("invoice-fetch is not offered to sub-agents and cannot be spawned", async () => {
  assert.ok(!availableRoles(ROLES).some((r) => r.name === "invoice-fetch"));
  const { summary } = await manager.create(project.id);
  await assert.rejects(manager.spawnChild(summary.id, { role: "invoice-fetch" }), /Unknown agent role/);
});

test("an explorer thread gets no browser tools", async () => {
  const { summary } = await manager.create(project.id, "explorer");
  assert.ok(!liveMap<Live>(manager).get(summary.id)!.session.getActiveToolNames().some((t) => t.startsWith("browser_")));
});

test("with the browser disabled an invoice-fetch thread is refused and leaves no meta", async () => {
  const before = metaIds();
  store.patchConfig({ browserEnabled: false });
  try {
    await assert.rejects(manager.create(project.id, "invoice-fetch"), /needs the browser/);
    assert.deepEqual(metaIds(), before);
  } finally {
    store.patchConfig({ browserEnabled: true });
  }
});
