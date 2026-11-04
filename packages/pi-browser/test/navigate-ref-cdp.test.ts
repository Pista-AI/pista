import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { runReplay } from "../src/replay.ts";
import { registerBrowserTools, type BrowserTraceEntry } from "../src/tools.ts";

// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
let server: Server;
let driver: CdpDriver | undefined;
let base = "";
const trace: BrowserTraceEntry[] = [];
const tools = new Map<string, { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> }>();
const call = async (name: string, params: Record<string, unknown> = {}) => (await tools.get(name)!.execute("t", params)).content.map((c) => c.text ?? "").join("\n");

before(async () => {
  if (skip) return;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/f.pdf") return void res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4\n%%EOF\n");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (url.pathname === "/inv") return void res.end(`<title>Invoice</title><h1>Invoice ${url.searchParams.get("s") ?? "NOT FOUND"}</h1><a href="/f.pdf">Get PDF</a>`);
    res.end(`<title>List</title><a href="/inv?s=secret-42&x=1#top">Open invoice</a>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  // The cdp driver cannot save files, so the download fetches the address itself.
  driver = Object.assign(new CdpDriver(CDP), {
    download: async ({ path, url }: { path: string; url?: string }) => {
      const r = await fetch(url!);
      const bytes = Buffer.from(await r.arrayBuffer());
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      return { bytes: bytes.length, contentType: r.headers.get("content-type") ?? undefined, urlChain: [url!] };
    },
  });
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver!, { keepPageViews: 0, downloadRoot: () => mkdtempSync(join(tmpdir(), "navref-")), onTrace: (e) => trace.push(e) });
});
after(() => {
  driver?.close();
  server?.close();
  server?.closeAllConnections();
});

test("browser_navigate with a ref opens the link's exact address and traces a click, not an address", { skip }, async () => {
  await call("browser_navigate", { url: base });
  const snap = await call("browser_snapshot");
  const ref = /\[?(e\d+)\]?[^\n]*Open invoice/.exec(snap)?.[1] ?? assert.fail(snap);
  trace.length = 0;
  const out = JSON.parse((await call("browser_navigate", { ref })).split("\n}")[0] + "\n}") as { url: string };
  // The address as the page has it, query string included.
  assert.ok(out.url.includes("/inv?s=secret-42&x=1"), out.url);
  assert.match(await call("browser_read"), /Invoice secret-42/);
  assert.equal(trace.length, 1);
  const click = trace[0] as Extract<BrowserTraceEntry, { kind: "click" }>;
  assert.equal(click.kind, "click");
  assert.equal(click.locator.name, "Open invoice");
  assert.equal(click.urlAfter, out.url);
  // The stored step is a normal click: replay follows the link in the same tab, then downloads.
  const dir = mkdtempSync(join(tmpdir(), "navref-replay-"));
  const steps = [
    { kind: "click" as const, target: { role: click.locator.role, name: click.locator.name }, expect: { text: "Invoice secret-42" } },
    { kind: "download" as const, target: { role: "link", name: "Get PDF" }, fileType: "pdf" },
  ];
  const r = await runReplay({ startUrl: base, steps }, { driver: driver!, allowUrl: () => true, domainRules: { allowedDomains: ["127.0.0.1"] }, downloadRoot: dir, downloadPath: "x.pdf", confirmRisk: async () => true, expectTimeoutMs: 5000 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(readFileSync(join(dir, "x.pdf"), "latin1").startsWith("%PDF"));
});

test("browser_navigate needs exactly one of url or ref", { skip }, async () => {
  await assert.rejects(call("browser_navigate", {}), /exactly one/);
  await assert.rejects(call("browser_navigate", { url: base, ref: "e1" }), /exactly one/);
});
