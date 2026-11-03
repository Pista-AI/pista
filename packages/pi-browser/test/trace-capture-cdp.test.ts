import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { registerBrowserTools, type BrowserTraceEntry } from "../src/tools.ts";

// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
let server: Server;
let driver: CdpDriver | undefined;
let base = "";
const trace: BrowserTraceEntry[] = [];
const tools = new Map<string, { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> }>();
const call = async (name: string, params: Record<string, unknown> = {}) => {
  const res = await tools.get(name)!.execute("t", params);
  return res.content.map((c) => c.text ?? "").join("\n");
};
const refOf = (snap: string, label: string) => new RegExp(`\\[?(e\\d+)\\]?[^\\n]*${label}`).exec(snap)?.[1] ?? assert.fail(`no ref for ${label} in ${snap}`);

before(async () => {
  if (skip) return;
  const root = join(import.meta.dirname, "fixture");
  server = createServer((req, res) => {
    try {
      const body = readFileSync(join(root, new URL(req.url ?? "/", "http://x").pathname)).toString().replace("{{LABEL}}", "Download invoice");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/invoices/`;
  // The cdp driver cannot save files, so downloads are stubbed; the trace only needs the call to succeed.
  driver = Object.assign(new CdpDriver(CDP), { download: async () => ({ bytes: 5, contentType: "application/pdf" }) });
  const dir = mkdtempSync(join(tmpdir(), "trace-capture-"));
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver!, { keepPageViews: 0, downloadRoot: () => dir, onTrace: (e) => trace.push(e) });
});
after(() => {
  driver?.close();
  server?.close();
  server?.closeAllConnections();
});

test("the trace records navigate, click locators resolved before the click, and a download", { skip }, async () => {
  await call("browser_navigate", { url: `${base}home.html` });
  const snap = await call("browser_snapshot");
  await call("browser_click", { ref: refOf(snap, "Billing") });
  // The invoice list is in an iframe: the page names its address, and the model opens it.
  await call("browser_navigate", { url: `${base}list.html` });
  const list = await call("browser_snapshot");
  await call("browser_download", { ref: refOf(list, "Download invoice"), path: "invoices/a.pdf" });
  assert.deepEqual(trace.map((t) => t.kind), ["navigate", "click", "navigate", "download"]);
  const click = trace[1] as Extract<BrowserTraceEntry, { kind: "click" }>;
  assert.equal(click.locator.role, "link");
  assert.equal(click.locator.name, "Billing");
  assert.equal(click.locator.text, "Billing");
  assert.equal(click.urlAfter, `${base}billing.html`);
  const dl = trace[3] as Extract<BrowserTraceEntry, { kind: "download" }>;
  assert.equal(dl.url, `${base}inv-001.pdf`);
  assert.equal(dl.contentType, "application/pdf");
  assert.equal(dl.path, "invoices/a.pdf");
});
