import assert from "node:assert/strict";
import { test } from "node:test";
import type { Playbook } from "@pista/protocol";
import { liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("playbook-run", { cleanup: "exit" });
const { approvalExtension } = await import("./extensions.ts");
const { playbookGuardMessage, recordRun } = await import("./playbook-run.ts");
const { PlaybookTrace, savePlaybookFromTrace } = await import("./playbook-capture.ts");
const { getPlaybook, savePlaybook, validatePlaybook } = await import("./playbooks.ts");

const B = "http://127.0.0.1:8765/invoices/";
function save(steps: unknown[] = [{ kind: "click", target: { role: "link", name: "October 2026" } }, { kind: "download", target: { role: "link", name: "Download invoice" }, fileType: "pdf" }]): Playbook {
  const pb = validatePlaybook({ startUrl: `${B}months.html`, steps }, "127.0.0.1");
  savePlaybook(pb);
  return pb;
}
const handoff = (reason: "not-found" | "declined" | "aborted") => ({ ok: false as const, failedIndex: 2, step: { kind: "download" as const }, reason, detail: "", url: "", snapshot: "" });

test("the guard refuses a site with a playbook until playbook_run was tried there, and ignores other sites", () => {
  save();
  const attempted = new Set<string>();
  assert.match(playbookGuardMessage(attempted, `${B}home.html`) ?? "", /saved playbook exists for 127\.0\.0\.1.*playbook_run/);
  assert.equal(playbookGuardMessage(attempted, "https://example.org/"), undefined);
  assert.equal(playbookGuardMessage(attempted, "/relative"), undefined);
  attempted.add("127.0.0.1");
  assert.equal(playbookGuardMessage(attempted, `${B}home.html`), undefined);
});

test("only a role that lists playbook_run is guarded; a thread without it navigates freely", async () => {
  save();
  const { manager, project } = await makeManager({ projectDir });
  type Live = { session: { extensionRunner: { emitToolCall(e: unknown): Promise<{ block?: boolean; reason?: string } | undefined> } } };
  const nav = async (id: string) => liveOf<Live>(manager).get(id)!.session.extensionRunner.emitToolCall({ type: "tool_call", toolName: "browser_navigate", toolCallId: "c1", input: { url: `${B}home.html` } });
  const invoice = (await manager.create(project.id, "invoice-fetch")).summary.id;
  assert.match((await nav(invoice))?.reason ?? "", /playbook_run/);
  const plain = (await manager.create(project.id)).summary.id;
  assert.equal((await nav(plain))?.block, undefined);
});

test("a playbook_run the approval gate declines still opens the site for the thread and records no failure", async () => {
  save();
  const { manager, store, project } = await makeManager({ projectDir });
  store.patchConfig({ approvalMode: "ask-writes" }); // no window is connected, so the ask is refused
  type Live = { session: { extensionRunner: { emitToolCall(e: unknown): Promise<{ block?: boolean; reason?: string } | undefined> } } };
  const id = (await manager.create(project.id, "invoice-fetch")).summary.id;
  const emit = (toolName: string, input: unknown) => liveOf<Live>(manager).get(id)!.session.extensionRunner.emitToolCall({ type: "tool_call", toolName, toolCallId: "c1", input });
  assert.equal((await emit("playbook_run", { site: B, invoice: { date: "2026-10-03" } }))?.block, true);
  assert.equal((await emit("browser_navigate", { url: `${B}home.html` }))?.block, undefined);
  assert.equal(getPlaybook("127.0.0.1")!.failCount, 0);
});

test("failures count towards needs-attention at three; declines and stops do not count; a success resets", () => {
  save();
  assert.deepEqual(recordRun("127.0.0.1", handoff("declined"), "t"), []);
  assert.deepEqual(recordRun("127.0.0.1", handoff("aborted"), "t"), []);
  assert.equal(getPlaybook("127.0.0.1")!.failCount, 0);
  assert.deepEqual(recordRun("127.0.0.1", handoff("not-found"), "t"), []);
  assert.deepEqual(recordRun("127.0.0.1", handoff("not-found"), "t"), []);
  assert.deepEqual(recordRun("127.0.0.1", handoff("not-found"), "t"), [{ type: "playbook.event", threadId: "t", kind: "needs-attention", site: "127.0.0.1", step: 2 }]);
  assert.equal(getPlaybook("127.0.0.1")!.status, "needs-attention");
  assert.deepEqual(recordRun("127.0.0.1", handoff("not-found"), "t"), [], "flagged once");
  const ok = { ok: true as const, download: { path: "invoices/a.pdf", bytes: 10 }, steps: 2 };
  assert.deepEqual(recordRun("127.0.0.1", ok, "t"), [{ type: "playbook.event", threadId: "t", kind: "followed", site: "127.0.0.1" }]);
  assert.deepEqual([getPlaybook("127.0.0.1")!.status, getPlaybook("127.0.0.1")!.failCount], ["ok", 0]);
});

type Handler = (event: unknown, ctx: unknown) => Promise<{ block?: boolean } | undefined>;
function gate(mode: "ask-writes" | "full-access", confirmSignIns?: boolean) {
  const asks: Record<string, unknown>[] = [];
  const hub = { ask: async (build: (id: string) => Record<string, unknown>) => (asks.push(build("a1")), { allow: true, always: true }) } as never;
  const store = { config: { approvalMode: mode, confirmSignIns }, toolRules: undefined } as never;
  const handlers = new Map<string, Handler>();
  (approvalExtension(hub, store, { threadId: "t" } as never) as unknown as { factory: (pi: unknown) => void }).factory({ on: (n: string, h: Handler) => handlers.set(n, h), getAllTools: () => [] });
  return { asks, call: (site: string) => handlers.get("tool_call")!({ toolName: "playbook_run", input: { site, invoice: { date: "2026-10-03" } } }, {}) };
}

test("ask mode asks once per run with a card naming the playbook, never remembered; auto mode does not ask", async () => {
  save();
  const ask = gate("ask-writes");
  assert.equal(await ask.call("127.0.0.1"), undefined);
  assert.equal(await ask.call("127.0.0.1"), undefined);
  assert.equal(ask.asks.length, 2, "an earlier yes with always does not cover the next run");
  assert.equal(ask.asks[0]!.action, "Follow the saved playbook for 127.0.0.1? (2 steps)");
  assert.equal(await ask.call("example.org"), undefined);
  assert.equal(ask.asks.length, 2, "no playbook, nothing to ask");
  const auto = gate("full-access");
  assert.equal(await auto.call("127.0.0.1"), undefined);
  assert.equal(auto.asks.length, 0);
});

test("a playbook that signs in is asked about in auto mode too, unless sign-in confirmation is off", async () => {
  save([{ kind: "signIn", origin: "http://127.0.0.1:8765" }, { kind: "download", url: `${B}inv-001.pdf` }]);
  const auto = gate("full-access");
  await auto.call("127.0.0.1");
  assert.equal(auto.asks.length, 1);
  const off = gate("full-access", false);
  await off.call("127.0.0.1");
  assert.equal(off.asks.length, 0);
});

test("after a handoff, saving keeps the replayed steps and replaces only the repaired one", () => {
  const old = save();
  const trace = new PlaybookTrace();
  trace.add({ kind: "navigate", url: old.startUrl });
  trace.add({ kind: "replayed", index: 1, step: old.steps[0]! });
  trace.add({ kind: "download", source: "ref", locator: { role: "link", name: "Get PDF" }, url: `${B}inv-2026-10a.pdf`, contentType: "application/pdf", path: "invoices/a.pdf" });
  const r = savePlaybookFromTrace(trace.list(), [1, 2, 3], undefined, "t");
  assert.deepEqual(r.event, { type: "playbook.event", threadId: "t", kind: "updated", site: "127.0.0.1", step: 2 });
  const pb = getPlaybook("127.0.0.1")!;
  assert.deepEqual(pb.steps[0], old.steps[0]);
  assert.match(pb.history.at(-1)!.summary, /changed step 2$/);
});
