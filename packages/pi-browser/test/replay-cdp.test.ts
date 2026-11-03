import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { runReplay, type ReplayStep } from "../src/replay.ts";

// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
let server: Server;
let driver: CdpDriver | undefined;
let base = "";
let label = "Download invoice";
const dir = mkdtempSync(join(tmpdir(), "replay-cdp-"));

before(async () => {
  if (skip) return;
  const root = join(import.meta.dirname, "fixture");
  // Same behaviour as serve-fixtures.ts: /__fixture/label changes the download link's label, never its address.
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/__fixture/label") return void res.writeHead(200).end((label = url.searchParams.get("text") || "Download invoice"));
    if (url.pathname === "/invoices/inv-001.pdf") return void res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4\n%%EOF\n");
    try {
      const body = readFileSync(join(root, url.pathname)).toString().replace("{{LABEL}}", label);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/invoices/`;
  // The cdp driver cannot save files, so the download fetches the address itself (a link is always downloaded by address).
  driver = Object.assign(new CdpDriver(CDP), {
    download: async ({ path, url }: { path: string; url?: string }) => {
      const r = await fetch(url!);
      const bytes = Buffer.from(await r.arrayBuffer());
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      return { bytes: bytes.length, contentType: r.headers.get("content-type") ?? undefined, urlChain: [url!] };
    },
  });
});
after(() => {
  driver?.close();
  server?.close();
  server?.closeAllConnections();
});

const steps = (): ReplayStep[] => [
  { kind: "click", target: { role: "button", name: "Sign in" }, expect: { urlIncludes: "/home.html", text: "Welcome back" } },
  { kind: "click", target: { role: "link", name: "Billing" }, expect: { urlIncludes: "/billing.html" } },
  { kind: "navigate", url: `${base}list.html` },
  { kind: "download", target: { role: "link", name: "Download invoice" }, fileType: "pdf" },
];
const options = (path: string) => ({ driver: driver!, domainRules: { allowedDomains: ["127.0.0.1"] }, downloadRoot: dir, downloadPath: path, confirmRisk: async () => true, expectTimeoutMs: 5000 });

test("a hand-written playbook for the fixture replays to a downloaded PDF", { skip }, async () => {
  const seen: string[] = [];
  const r = await runReplay({ startUrl: `${base}login.html`, steps: steps() }, { ...options("invoices/a.pdf"), onStep: (i, s) => seen.push(`${i}:${s}`) });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.download.contentType, "application/pdf");
  assert.ok(readFileSync(join(dir, "invoices/a.pdf"), "latin1").startsWith("%PDF"));
  assert.equal(r.steps, 4);
  assert.equal(seen.at(-1), "4:done");
});

test("a renamed download link hands off at the download step with the page snapshot", { skip }, async () => {
  await fetch(`${base.replace("/invoices/", "")}/__fixture/label?text=Get%20PDF`);
  try {
    const r = await runReplay({ startUrl: `${base}login.html`, steps: steps() }, options("invoices/b.pdf"));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.failedIndex, 4);
    assert.equal(r.step.kind, "download");
    assert.equal(r.reason, "not-found");
    assert.ok(r.snapshot.includes("Get PDF"), r.snapshot);
    assert.equal(r.url, `${base}list.html`);
  } finally {
    await fetch(`${base.replace("/invoices/", "")}/__fixture/label`);
  }
});

test("without the user's yes, the consequential sign-in click hands off as declined", { skip }, async () => {
  const r = await runReplay({ startUrl: `${base}login.html`, steps: steps() }, { ...options("invoices/c.pdf"), confirmRisk: undefined });
  assert.equal(!r.ok && r.reason, "declined");
  assert.equal(!r.ok && r.failedIndex, 1);
});
