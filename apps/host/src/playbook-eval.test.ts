// Fixture eval of the whole playbook loop with a scripted (faux) model: discover and save, replay, hand off and repair, replay again.
// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxModels, liveOf, makeManager, serialiseChromeEval, setupHome } from "./test-helpers.ts";

const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
process.env.PISTA_BROWSER_DRIVER = "cdp";
process.env.PI_BROWSER_CDP_URL = CDP;

const { projectDir } = setupHome("playbook-eval", { cleanup: "exit" });
const { CdpDriver } = await import("@pista/pi-browser");
const { getPlaybook } = await import("./playbooks.ts");
const { Hub } = await import("./hub.ts");

// The cdp driver cannot save files, so a download fetches the address itself (replay and browser_download both resolve links to addresses).
// The host's shared driver is remembered so the test can close its connection at the end.
const drivers = new Set<InstanceType<typeof CdpDriver>>();
const proto = CdpDriver.prototype as unknown as Record<string, unknown>;
const original = { state: proto.state, download: proto.download };
const state = CdpDriver.prototype.state;
Object.assign(CdpDriver.prototype, {
  state(this: InstanceType<typeof CdpDriver>) {
    drivers.add(this);
    return state.call(this);
  },
  download: async ({ path, url }: { path: string; url?: string }) => {
    const r = await fetch(url!);
    const bytes = Buffer.from(await r.arrayBuffer());
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return { bytes: bytes.length, contentType: r.headers.get("content-type") ?? undefined, urlChain: [url!] };
  },
});

// The pi-browser invoice fixture; /__fixture/label renames the month pages' download links without changing their address.
const fixture = join(dirname(fileURLToPath(import.meta.resolve("@pista/pi-browser"))), "../test/fixture");
let label = "Download invoice";
let server: Server;
let base = "";
before(async () => {
  if (skip) return;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/__fixture/label") return void res.writeHead(200).end((label = url.searchParams.get("text") || "Download invoice"));
    const dated = /^\/invoices\/(inv-2026-\d\d[ab]?)\.pdf$/.exec(url.pathname);
    if (dated) return void res.writeHead(200, { "content-type": "application/pdf" }).end(`%PDF-1.4\n% ${dated[1]}\n%%EOF\n`);
    try {
      const body = readFileSync(join(fixture, url.pathname)).toString();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(/\/m-2026-\d\d\.html$/.test(url.pathname) ? body.replaceAll("Download invoice", label) : body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/invoices/`;
});
after(async () => {
  label = "Download invoice";
  for (const d of drivers) d.close();
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete proto[k];
    else proto[k] = v;
  }
  server?.close();
  server?.closeAllConnections();
});

// A window that says yes to every card and records what the host sent.
const hub = new Hub();
const events: Record<string, unknown>[] = [];
hub.add({ readyState: 1, OPEN: 1, on: () => {}, send: (frame: string) => {
  const { event } = JSON.parse(frame) as { event: Record<string, unknown> };
  events.push(event);
  if (event.type === "approval.request") queueMicrotask(() => hub.settle(event.approvalId as string, { allow: true }));
} } as never);

const { piAi, faux, models, ref } = await fauxModels();
const { manager, store, project } = await makeManager({ projectDir, models, hub });
store.patchConfig({ defaultModel: ref, approvalMode: "ask-writes" });
if (!skip) serialiseChromeEval();

type Ctx = { messages: { role: string; content: string | { type: string; text?: string; name?: string }[] }[] };
const lastText = (ctx: Ctx) => {
  const c = ctx.messages.at(-1)!.content;
  return typeof c === "string" ? c : c.map((p) => p.text ?? "").join("\n");
};
const call = (name: string, args: Record<string, unknown> | ((ctx: Ctx) => Record<string, unknown>)) => (ctx: Ctx) => piAi.fauxAssistantMessage(piAi.fauxToolCall(name, typeof args === "function" ? args(ctx) : args));
const snapshot = call("browser_snapshot", {});
const refs = (snap: string, name: string) => [...snap.matchAll(new RegExp(`\\[(e\\d+)\\][^\\n]*"${name}"`, "g"))].map((m) => m[1]!);
const allEntries = (ctx: Ctx) => [...lastText(ctx).matchAll(/^(\d+) /gm)].map((m) => Number(m[1]));
const results: string[] = [];
const done = (ctx: Ctx) => (results.push(lastText(ctx)), piAi.fauxAssistantMessage("Done."));

type Live = { session: { messages: { role: string; content: { type: string; name?: string }[] }[] } };
const toolCalls = (id: string) => liveOf<Live>(manager).get(id)!.session.messages.filter((m) => m.role === "assistant").flatMap((m) => m.content.filter((c) => c.type === "toolCall").map((c) => c.name!));
async function run(script: ((ctx: Ctx) => unknown)[]) {
  const id = (await manager.create(project.id, "invoice-fetch")).summary.id;
  faux.setResponses(script);
  await (await manager.startPrompt(id, "Fetch the invoice.", undefined)).run;
  return id;
}
const file = (p: string) => readFileSync(join(projectDir, p), "latin1");
const playbookEvents = () => events.filter((e) => e.type === "playbook.event");

test("run 1: the model explores, downloads one row of one month, and saves a parameterised playbook", { skip }, async () => {
  const path = "invoices/2026-10/fixture-2026-10-03-49.00.pdf";
  await run([
    call("browser_navigate", { url: `${base}login.html` }),
    snapshot,
    call("browser_click", (ctx) => ({ ref: refs(lastText(ctx), "Sign in")[0] })),
    call("browser_navigate", { url: `${base}months.html` }),
    snapshot,
    call("browser_click", (ctx) => ({ ref: refs(lastText(ctx), "October 2026")[0] })),
    snapshot,
    call("browser_download", (ctx) => ({ ref: refs(lastText(ctx), "Download invoice")[0], path })),
    call("playbook_save", {}),
    call("playbook_save", (ctx) => ({ steps: allEntries(ctx), invoice: { date: "2026-10-03", amount: 49, currency: "EUR" } })),
    done,
  ]);
  assert.match(results.at(-1)!, /^Saved a playbook for 127\.0\.0\.1/, results.at(-1)!);
  assert.match(file(path), /inv-2026-10a/);
  const pb = getPlaybook("127.0.0.1")!;
  const json = JSON.stringify(pb);
  assert.ok(pb.steps.some((s) => s.kind === "click" && s.target.period), json);
  assert.ok(pb.steps.some((s) => s.kind === "download" && s.target?.row), json);
  for (const rowText of ["2026-10-03", "49.00", "October", "inv-2026-10a"]) assert.ok(!json.includes(rowText), `${rowText} in ${json}`);
  assert.deepEqual(playbookEvents().map((e) => e.kind), ["learned"]);
});

test("run 2: another month is fetched by playbook_run alone, with no browser exploration", { skip }, async () => {
  const path = "invoices/2026-09/fixture-2026-09-17-12.00.pdf";
  const id = await run([call("playbook_run", { site: base, invoice: { date: "2026-09-17", amount: 12, currency: "EUR" }, path }), done]);
  assert.match(results.at(-1)!, /Followed the saved playbook/, results.at(-1)!);
  assert.deepEqual(toolCalls(id), ["playbook_run"]);
  assert.match(file(path), /inv-2026-09b/);
  const steps = getPlaybook("127.0.0.1")!.steps.length;
  assert.ok(events.some((e) => e.type === "approval.request" && e.action === `Follow the saved playbook for 127.0.0.1? (${steps} steps)`), "asked once in ask mode");
  assert.equal(playbookEvents().at(-1)!.kind, "followed");
});

test("run 3: a renamed link hands off at the download step; the model repairs it and the playbook is updated; run 4 follows the new label", { skip }, async () => {
  await fetch(`${base}../__fixture/label?text=Get%20PDF`);
  try {
    const steps = getPlaybook("127.0.0.1")!.steps.length;
    const path = "invoices/2026-10/fixture-2026-10-20-12.00.pdf";
    let handoff = "";
    const id = await run([
      call("playbook_run", { site: base, invoice: { date: "2026-10-20", amount: 12, currency: "EUR" }, path }),
      (ctx: Ctx) => ((handoff = lastText(ctx)), snapshot(ctx)),
      call("browser_download", (ctx) => ({ ref: refs(lastText(ctx), "Get PDF")[1], path })),
      call("playbook_save", {}),
      call("playbook_save", (ctx) => ({ steps: allEntries(ctx), invoice: { date: "2026-10-20", amount: 12, currency: "EUR" } })),
      done,
    ]);
    assert.match(handoff, new RegExp(`stopped at step ${steps} of ${steps} \\(download`), handoff);
    assert.match(handoff, /dated 2026-10-20, amount 12 EUR/);
    assert.match(handoff, /<<<website-data\nDetail: [^]*website-data>>>$/);
    assert.deepEqual(toolCalls(id), ["playbook_run", "browser_snapshot", "browser_download", "playbook_save", "playbook_save"]);
    assert.match(file(path), /inv-2026-10b/);
    // The host already repaired the playbook when the download succeeded, so the model's own save finds nothing left to change.
    assert.match(results.at(-1)!, /already matches this path; nothing changed/, results.at(-1)!);
    const pb = getPlaybook("127.0.0.1")!;
    assert.equal(pb.failCount, 0);
    assert.equal(pb.status, "ok");
    assert.ok(pb.history.some((h) => new RegExp(`^repaired after handoff at step ${steps}; .*changed step ${steps}$`).test(h.summary)), JSON.stringify(pb.history));
    assert.equal(pb.steps.length, steps);

    const path4 = "invoices/2026-11/fixture-2026-11-03-49.00.pdf";
    const id4 = await run([call("playbook_run", { site: base, invoice: { date: "2026-11-03", amount: 49, currency: "EUR" }, path: path4 }), done]);
    assert.match(results.at(-1)!, /Followed the saved playbook/, results.at(-1)!);
    assert.deepEqual(toolCalls(id4), ["playbook_run"]);
    assert.match(file(path4), /inv-2026-11a/);
  } finally {
    await fetch(`${base}../__fixture/label`);
  }
});
