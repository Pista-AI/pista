import assert from "node:assert/strict";
import { test } from "node:test";
import { liveOf as liveMap, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("toplevel-role");
const { manager, store, project } = await makeManager({ projectDir });
type Live = { session: { getActiveToolNames(): string[]; systemPrompt: string; extensionRunner: { emitToolCall(e: unknown): Promise<{ block?: boolean } | undefined> } } };

test("a top-level thread can run as invoice-fetch: prompt, tools and gate apply, and it is not a child", async () => {
  const { summary } = await manager.create(project.id, "invoice-fetch");
  assert.equal(summary.parentId, undefined);
  assert.deepEqual(store.getThreadMeta(summary.id), { role: "invoice-fetch" });
  const { session } = liveMap<Live>(manager).get(summary.id)!;
  assert.match(session.systemPrompt, /Never open, log in to, or ask the owner to log in to a bank/);
  const tools = session.getActiveToolNames();
  for (const t of ["read", "write", "bash", "browser_navigate", "browser_eval"]) assert.ok(tools.includes(t), t);
  assert.ok(!tools.includes("agent"));
  const gate = (toolName: string) => session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "x", toolName, input: {} });
  assert.equal((await gate("edit"))?.block, true);
});

test("an unknown role is rejected and leaves no thread meta behind", async () => {
  for (const role of ["bogus", "__proto__", "toString"]) await assert.rejects(manager.create(project.id, role), /Unknown agent role/, role);
  assert.deepEqual(Object.keys((store as unknown as { state: { threadMeta: object } }).state.threadMeta).filter((id) => store.getThreadMeta(id)?.role === "bogus"), []);
});
