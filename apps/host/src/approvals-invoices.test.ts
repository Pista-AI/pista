import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("approvals-invoices-test", { cleanup: "exit" });
const { approvalExtension } = await import("./extensions.ts");
const { invoiceWriteGate } = await import("./children.ts");

function setup(role: string | undefined) {
  const cwd = mkdtempSync(join(tmpdir(), "pista-inv-"));
  let asked = 0;
  const hub = { ask: async () => (asked++, { allow: true }) } as never;
  const store = { config: { approvalMode: "ask-writes" }, toolRules: undefined } as never;
  const ext = approvalExtension(hub, store, { threadId: "t" } as never, undefined, invoiceWriteGate({ role, restricted: true, isChild: false } as never, cwd));
  const handlers = new Map<string, (e: any, c: any) => Promise<any>>();
  (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (n: string, h: never) => handlers.set(n, h), getAllTools: () => [] });
  return { cwd, asked: () => asked, call: (toolName: string, input: Record<string, unknown>) => handlers.get("tool_call")!({ toolName, input }, {}) };
}

test("invoice-fetch may write under invoices/ without a prompt", async () => {
  const s = setup("invoice-fetch");
  await s.call("write", { path: "invoices/2026-09/adobe-2026-09-03-59.99.pdf", content: "x" });
  await s.call("write", { path: join(s.cwd, "invoices", "manifest.json"), content: "[]" });
  await s.call("write", { path: ".pista/PLAN.md", content: "x" });
  assert.equal(s.asked(), 0);
});

test("invoice-fetch still asks for writes elsewhere, for bash and for edit", async () => {
  const s = setup("invoice-fetch");
  await s.call("write", { path: "notes.txt", content: "x" });
  await s.call("write", { path: ".pista/../notes.txt", content: "x" });
  await s.call("write", { path: "invoices/../notes.txt", content: "x" });
  await s.call("bash", { command: "echo hi > invoices/a.txt" });
  await s.call("edit", { path: "invoices/a.txt" });
  assert.equal(s.asked(), 5);
});

test("other roles and role-less threads still ask for invoices/ writes", async () => {
  for (const role of [undefined, "implementer"]) {
    const s = setup(role);
    await s.call("write", { path: "invoices/a.pdf", content: "x" });
    assert.equal(s.asked(), 1);
  }
});

test("a real invoice-fetch thread from create() is auto-allowed under invoices/ and still prompts elsewhere", async () => {
  const { makeManager } = await import("./test-helpers.ts");
  const { extensionsFor } = await import("./children.ts");
  const projectDir = mkdtempSync(join(tmpdir(), "pista-inv-real-"));
  const { manager, store, project } = await makeManager({ projectDir });
  const { summary } = await manager.create(project.id, "invoice-fetch");
  const kind = (manager as unknown as { children: { kindOf(id: string): never } }).children.kindOf(summary.id) as { role: string; hasParent?: boolean };
  assert.equal(kind.role, "invoice-fetch");
  assert.equal(kind.hasParent, undefined);
  let asked = 0;
  const hub = { ask: async () => (asked++, { allow: true }) } as never;
  const ext = extensionsFor(kind as never, { store, hub, ref: { threadId: summary.id }, threads: manager as never, plan: {} as never, cwd: project.path }).find((e) => typeof e !== "function" && e.name === "approvals")!;
  const handlers = new Map<string, (e: any, c: any) => Promise<any>>();
  (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (n: string, h: never) => handlers.set(n, h), getAllTools: () => [] });
  const call = (toolName: string, input: Record<string, unknown>) => handlers.get("tool_call")!({ toolName, input }, {});
  await call("write", { path: "invoices/2026-09/a.pdf", content: "x" });
  assert.equal(asked, 0);
  await call("write", { path: "notes.txt", content: "x" });
  assert.equal(asked, 1);
});
