import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("login-tool-test", { cleanup: "exit" });
const { approvalExtension } = await import("./extensions.ts");
const { invoiceReadGate, invoiceWriteGate } = await import("./children.ts");
const { classifyTool } = await import("./audit-events.ts");
const { PaneBrowserDriver } = await import("./browser-driver.ts");
const { INVOICE_FETCH_ROLE } = await import("./invoice-role.ts");

function approvals(cwd: string, kind: object = { role: "invoice-fetch", restricted: true, isChild: false }, config: Record<string, unknown> = {}) {
  let asked = 0;
  const hub = { ask: async () => (asked++, { allow: true }) } as never;
  const store = { config: { approvalMode: "ask-writes", ...config }, toolRules: undefined } as never;
  const ext = approvalExtension(hub, store, { threadId: "t" } as never, undefined, invoiceWriteGate(kind as never, cwd), invoiceReadGate(kind as never, cwd));
  const handlers = new Map<string, (e: any, c: any) => Promise<any>>();
  (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (n: string, h: never) => handlers.set(n, h), getAllTools: () => [] });
  return { asked: () => asked, call: (toolName: string, input: Record<string, unknown>) => handlers.get("tool_call")!({ toolName, input }, {}) };
}

test("browser_login goes through the approval gate", async () => {
  const a = approvals(mkdtempSync(join(tmpdir(), "pista-login-")));
  await a.call("browser_login", { site: "Fixture" });
  assert.equal(a.asked(), 1);
});

test("audit: browser_login records the site name as an attribute", () => {
  const c = classifyTool("browser_login", { site: "Fixture" });
  assert.equal(c.kind, "browser");
  assert.equal(c.attrs["browser.action"], "login");
  assert.equal(c.attrs["login.site"], "Fixture");
});

test("PaneBrowserDriver maps login.list and login.fill to the hub", async () => {
  const requests: any[] = [];
  const answers: Record<string, unknown> = {
    "login.list": { logins: [{ id: "1", label: "Fixture", origin: "https://a.test" }] },
    "login.fill": { login: { ok: true, note: "Signed in." } },
  };
  const hub = {
    ask: async (make: (id: string) => any) => {
      const req = make("r1").request;
      requests.push(req);
      return answers[req.action];
    },
  } as never;
  const d = new PaneBrowserDriver(hub, { threadId: "t" } as never);
  assert.equal((await d.loginList()).length, 1);
  assert.deepEqual(await d.loginFill("Fixture"), { ok: true, note: "Signed in." });
  assert.deepEqual(requests.map((r) => [r.action, r.site]), [["login.list", undefined], ["login.fill", "Fixture"]]);
  answers["login.fill"] = { note: "nope" };
  await assert.rejects(d.loginFill("Fixture"), /nope/);
});

test("invoice role: no bash, has browser_login", () => {
  assert.ok(!INVOICE_FETCH_ROLE.tools.includes("bash"));
  assert.ok(INVOICE_FETCH_ROLE.tools.includes("browser_login"));
});

test("invoice read gate: refuses read and ls outside the project folder, allows inside", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pista-read-"));
  symlinkSync(tmpdir(), join(cwd, "link"));
  const a = approvals(cwd);
  for (const [tool, path] of [["read", "/etc/hosts"], ["read", "~"], ["read", "~/x"], ["read", "@/etc/hosts"], ["read", "link/x"], ["read", "../secret.txt"], ["ls", "/"], ["read", join(cwd, "..", "x")]] as const) {
    const r = await a.call(tool, { path });
    assert.equal(r?.block, true, `${tool} ${path}`);
    assert.equal(r.reason, "The invoice job only reads inside its project folder.");
  }
  for (const [tool, input] of [["read", { path: "invoices/manifest.json" }], ["read", { path: join(cwd, "notes.txt") }], ["ls", { path: "." }], ["ls", { path: cwd }], ["ls", {}]] as const) {
    assert.equal(await a.call(tool, input), undefined, `${tool} ${JSON.stringify(input)}`);
  }
  assert.equal(a.asked(), 0);
  // Other threads are not gated.
  const other = approvals(cwd, { role: undefined, restricted: false, isChild: false });
  assert.equal(await other.call("read", { path: "/etc/hosts" }), undefined);
});

test("a real invoice-fetch thread from create() refuses reads outside its project", async () => {
  const { makeManager } = await import("./test-helpers.ts");
  const { extensionsFor } = await import("./children.ts");
  const { manager, store, project } = await makeManager({ projectDir: mkdtempSync(join(tmpdir(), "pista-read-real-")) });
  const { summary } = await manager.create(project.id, "invoice-fetch");
  const kind = (manager as unknown as { children: { kindOf(id: string): never } }).children.kindOf(summary.id);
  const hub = { ask: async () => ({ allow: true }) } as never;
  const ext = extensionsFor(kind, { store, hub, ref: { threadId: summary.id }, threads: manager as never, plan: {} as never, cwd: project.path }).find((e) => typeof e !== "function" && e.name === "approvals")!;
  const handlers = new Map<string, (e: any, c: any) => Promise<any>>();
  (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (n: string, h: never) => handlers.set(n, h), getAllTools: () => [] });
  const call = (toolName: string, input: Record<string, unknown>) => handlers.get("tool_call")!({ toolName, input }, {});
  assert.equal((await call("read", { path: "/etc/hosts" })).block, true);
  assert.equal(await call("read", { path: "invoices/manifest.json" }), undefined);
});

test("invoice role: lists logins through browser_logins before any search, and keeps the secrets rules", () => {
  assert.ok(INVOICE_FETCH_ROLE.tools.includes("browser_logins"));
  const p = INVOICE_FETCH_ROLE.prompt ?? "";
  assert.match(p, /call browser_logins once/);
  assert.match(p, /before any web search/);
  assert.match(p, /Never type, store, repeat or ask for a password/);
});

test("sign-in confirmation: mode x confirmSignIns x tool", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-login-"));
  const none = { role: undefined, restricted: false, isChild: false };
  const cases: Array<[string, boolean | undefined, string, number]> = [
    ["full-access", undefined, "browser_login", 1],
    ["full-access", true, "browser_login", 1],
    ["full-access", false, "browser_login", 0],
    ["full-access", true, "browser_click", 0],
    ["ask-writes", false, "browser_login", 1],
    ["ask-writes", true, "browser_login", 1],
  ];
  for (const [approvalMode, confirmSignIns, tool, asked] of cases) {
    const a = approvals(dir, none, { approvalMode, confirmSignIns });
    await a.call(tool, { site: "Fixture" });
    assert.equal(a.asked(), asked, `${approvalMode} ${confirmSignIns} ${tool}`);
  }
});

test("sign-in confirmation ignores Always allow", async () => {
  let asked = 0;
  const hub = { ask: async () => (asked++, { allow: true, always: true }) } as never;
  const store = { config: { approvalMode: "ask-writes", confirmSignIns: true }, toolRules: undefined } as never;
  const ext = approvalExtension(hub, store, { threadId: "t" } as never, new Set<string>());
  const handlers = new Map<string, (e: any, c: any) => Promise<any>>();
  (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (n: string, h: never) => handlers.set(n, h), getAllTools: () => [] });
  await handlers.get("tool_call")!({ toolName: "browser_login", input: {} }, {});
  await handlers.get("tool_call")!({ toolName: "browser_login", input: {} }, {});
  assert.equal(asked, 2);
});
