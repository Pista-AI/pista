// Fixture eval of the host's first pass with a scripted (faux) model: pasted transactions of a vendor with a saved playbook are fetched before the model's first turn.
// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxModels, makeManager, setupHome } from "./test-helpers.ts";

const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
process.env.PISTA_BROWSER_DRIVER = "cdp";
process.env.PI_BROWSER_CDP_URL = CDP;

const { projectDir } = setupHome("playbook-first-pass-eval", { cleanup: "exit" });
const { CdpDriver } = await import("@pista/pi-browser");
const { savePlaybook, validatePlaybook } = await import("./playbooks.ts");
const { Hub } = await import("./hub.ts");

// The cdp driver cannot save files, so a download fetches the address itself. `onDownload` lets a test act at the n-th download (the second one stops the thread).
const drivers = new Set<InstanceType<typeof CdpDriver>>();
const proto = CdpDriver.prototype as unknown as Record<string, unknown>;
const original = { state: proto.state, download: proto.download };
const state = CdpDriver.prototype.state;
let downloads = 0;
let onDownload: (n: number) => Promise<void> = async () => {};
Object.assign(CdpDriver.prototype, {
  state(this: InstanceType<typeof CdpDriver>) {
    drivers.add(this);
    return state.call(this);
  },
  download: async ({ path, url }: { path: string; url?: string }) => {
    await onDownload(++downloads);
    const r = await fetch(url!);
    const bytes = Buffer.from(await r.arrayBuffer());
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return { bytes: bytes.length, contentType: r.headers.get("content-type") ?? undefined, urlChain: [url!] };
  },
});

// The pi-browser invoice fixture.
const fixture = join(dirname(fileURLToPath(import.meta.resolve("@pista/pi-browser"))), "../test/fixture");
let server: Server;
let base = "";
before(async () => {
  if (skip) return;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const dated = /^\/invoices\/(inv-2026-\d\d[ab]?)\.pdf$/.exec(url.pathname);
    if (dated) return void res.writeHead(200, { "content-type": "application/pdf" }).end(`%PDF-1.4\n% ${dated[1]}\n%%EOF\n`);
    let page: Buffer | undefined;
    try {
      page = readFileSync(join(fixture, url.pathname));
    } catch {
      /* not a fixture page */
    }
    if (page) res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/invoices/`;
  // A playbook with a confirmed keyword: open the months page, pick the month of the invoice, download the row that shows its date and amount.
  savePlaybook({
    ...validatePlaybook({
      startUrl: `${base}months.html`,
      steps: [
        { kind: "click", target: { role: "link", period: true } },
        { kind: "download", target: { role: "link", name: "Download invoice", row: { match: ["date", "amount"] } }, fileType: "pdf" },
      ],
    }, "127.0.0.1"),
    merchants: ["FIXTURE SHOP"],
  });
});
after(async () => {
  for (const d of drivers) d.close();
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete proto[k];
    else proto[k] = v;
  }
  server?.close();
  server?.closeAllConnections();
});

// A window that answers every card with `answer` and records what the host sent.
const hub = new Hub();
const events: Record<string, unknown>[] = [];
let answer = true;
hub.add({ readyState: 1, OPEN: 1, on: () => {}, send: (frame: string) => {
  const { event } = JSON.parse(frame) as { event: Record<string, unknown> };
  events.push(event);
  if (event.type === "approval.request") queueMicrotask(() => hub.settle(event.approvalId as string, { allow: answer }));
} } as never);

const { piAi, faux, models, ref } = await fauxModels();
const { manager, store, project } = await makeManager({ projectDir, models, hub });
store.patchConfig({ defaultModel: ref });

type Ctx = { messages: { role: string; content: string | { type: string; text?: string }[] }[] };
const lastText = (ctx: Ctx) => {
  const c = ctx.messages.at(-1)!.content;
  return typeof c === "string" ? c : c.map((p) => p.text ?? "").join("\n");
};
const PASTE = ["2026-09-17 FIXTURE SHOP -12.00 EUR", "2026-11-03 FIXTURE SHOP -49.00 EUR", "2026-10-05 SOMEBODY ELSE -7.00 EUR"].join("\n");
const files = ["invoices/2026-09/127-2026-09-17-12.00.pdf", "invoices/2026-11/127-2026-11-03-49.00.pdf"];
const path = (p: string) => join(projectDir, p);
const manifest = (): { file: string }[] => (existsSync(path("invoices/manifest.json")) ? JSON.parse(readFileSync(path("invoices/manifest.json"), "utf8")) : []);
const fresh = () => (rmSync(path("invoices"), { recursive: true, force: true }), (events.length = 0), (downloads = 0));

// One standalone invoice-fetch thread; each model turn is recorded with the files that existed when it started.
async function run(mode: "full-access" | "ask-writes", script: ((ctx: Ctx) => unknown)[], prep?: (id: string) => void) {
  store.patchConfig({ approvalMode: mode });
  const turns: { text: string; present: boolean[]; manifest: string[] }[] = [];
  const id = (await manager.create(project.id, "invoice-fetch")).summary.id;
  prep?.(id);
  faux.setResponses(script.map((step) => (ctx: Ctx) => (turns.push({ text: lastText(ctx), present: files.map((f) => existsSync(path(f))), manifest: manifest().map((m) => m.file) }), step(ctx))));
  await (await manager.startPrompt(id, PASTE, undefined)).run;
  return { id, turns };
}
const done = () => piAi.fauxAssistantMessage("Done.");
const data = (text: string) => /<<<pasted-lines\n([^]*)\npasted-lines>>>/.exec(text)?.[1] ?? "";

test("full access: known vendor lines are fetched before the model starts, which sees only the unknown line", { skip }, async () => {
  fresh();
  const { turns } = await run("full-access", [done]);
  assert.equal(turns.length, 1, "one model call, for the summary");
  const [first] = turns;
  assert.deepEqual(first!.present, [true, true], "both files existed before the first model call");
  assert.deepEqual(first!.manifest.slice().sort(), files.slice().sort(), "both are in the manifest");
  assert.match(readFileSync(path(files[0]!), "latin1"), /inv-2026-09b/);
  assert.match(readFileSync(path(files[1]!), "latin1"), /inv-2026-11a/);
  assert.match(first!.text, /Fetched \(2\)/);
  assert.equal(data(first!.text), "line 3: 2026-10-05 SOMEBODY ELSE -7.00 EUR");
  assert.equal(events.filter((e) => e.type === "approval.request").length, 0, "full access asks nothing");
});

test("ask mode, batch declined: nothing is downloaded, the routed lines are declined, and the guard stays shut", { skip }, async () => {
  fresh();
  answer = false;
  let blocked = "";
  try {
    const { turns } = await run("ask-writes", [
      () => piAi.fauxAssistantMessage(piAi.fauxToolCall("browser_navigate", { url: `${base}months.html` })),
      (ctx: Ctx) => ((blocked = lastText(ctx)), piAi.fauxAssistantMessage("Done.")),
    ]);
    assert.equal(events.filter((e) => e.type === "approval.request").length, 1, "asked once for the batch");
    assert.equal(downloads, 0, "no download ran");
    assert.ok(!existsSync(path("invoices/2026-09")) && !existsSync(path("invoices/2026-11")));
    assert.match(turns[0]!.text, /declined fetching these 2 automatically/);
    assert.match(turns[0]!.text, /- line 1: 127\.0\.0\.1\n- line 2: 127\.0\.0\.1/);
    assert.match(turns[0]!.text, /Do not fetch them; ask the user/);
    assert.equal(data(turns[0]!.text), "line 3: 2026-10-05 SOMEBODY ELSE -7.00 EUR");
    assert.match(blocked, /Blocked: a saved playbook exists for 127\.0\.0\.1/, "browser_navigate is still refused");
  } finally {
    answer = true;
  }
});

test("stop during the batch: the first file stays, the model never runs, and the thread settles", { skip }, async () => {
  fresh();
  let threadId = "";
  onDownload = async (n) => {
    if (n === 2) {
      await manager.abort(threadId);
      await new Promise(() => {}); // like a download that never ends: replay stops waiting on the abort
    }
  };
  try {
    const { turns } = await run("full-access", [done], (id) => (threadId = id));
    assert.equal(turns.length, 0, "the model did not start");
    assert.ok(existsSync(path(files[0]!)), "the first file stays");
    assert.ok(!existsSync(path(files[1]!)), "the second was not saved");
    assert.deepEqual(manifest().map((m) => m.file), [files[0]]);
    assert.ok(events.some((e) => e.type === "thread.event" && e.threadId === threadId && (e.event as { type?: string }).type === "agent_settled"), "agent_settled emitted");
  } finally {
    onDownload = async () => {};
  }
});
