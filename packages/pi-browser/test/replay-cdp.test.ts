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
    const dated = /^\/invoices\/(inv-2026-\d\d[ab]?)\.pdf$/.exec(url.pathname);
    if (dated) return void res.writeHead(200, { "content-type": "application/pdf" }).end(`%PDF-1.4\n% ${dated[1]}\n%%EOF\n`);
    try {
      const body = readFileSync(join(root, url.pathname)).toString().replace("{{LABEL}}", label).replace("{{OTHER}}", `http://localhost:${(server.address() as { port: number }).port}`);
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

const loneStep = (): ReplayStep => ({ kind: "download", target: { role: "link", name: "Download invoice" }, fileType: "pdf" });
const lone = (invoice: { date: string; amount?: number; currency?: string } | undefined, path: string, page = "list-single.html") => runReplay({ startUrl: `${base}${page}`, steps: [loneStep()] }, { ...options(path), invoice });

test("a download by address, a header date above a dateless row and an amount mismatch are not verified, and a detail page without a row are handed off", { skip }, async () => {
  const byUrl = await runReplay({ startUrl: `${base}list-single.html`, steps: [{ kind: "download", url: `${base}inv-2026-09.pdf` }] }, { ...options("invoices/u1.pdf"), invoice: { date: "2026-09-03" } });
  assert.equal(!byUrl.ok && byUrl.reason, "row-not-verified");
  assert.throws(() => readFileSync(join(dir, "invoices/u1.pdf")));
  const header = await lone({ date: "2026-11-03" }, "invoices/u2.pdf", "list-header.html");
  assert.equal(!header.ok && header.reason, "row-not-verified");
  const amount = await lone({ date: "2026-09-03", amount: 12, currency: "EUR" }, "invoices/u3.pdf");
  assert.equal(!amount.ok && amount.reason, "row-not-verified");
  const detail = await lone({ date: "2026-09-03", amount: 49, currency: "EUR" }, "invoices/u4.pdf", "detail-one.html");
  assert.equal(!detail.ok && detail.reason, "row-not-verified");
});

test("a lone download without a row rule is checked against the invoice date before it is taken", { skip }, async () => {
  const wrong = await lone({ date: "2026-10-03" }, "invoices/v1.pdf");
  assert.equal(!wrong.ok && wrong.reason, "row-not-verified");
  assert.ok(!wrong.ok && wrong.detail.includes("2026-10-03") && !wrong.detail.includes("Sep"), JSON.stringify(wrong));
  assert.throws(() => readFileSync(join(dir, "invoices/v1.pdf")));
  const right = await lone({ date: "2026-09-03" }, "invoices/v2.pdf");
  assert.ok(right.ok, JSON.stringify(right));
  assert.ok(readFileSync(join(dir, "invoices/v2.pdf"), "latin1").includes("inv-2026-09"));
  assert.deepEqual(right.verified, { date: true, amount: false, matchedBy: ["date"], offsetDays: 0 }); // no amount given: nothing claimed about it
  const withAmount = await lone({ date: "2026-09-03", amount: 49, currency: "EUR" }, "invoices/v4.pdf");
  assert.ok(withAmount.ok && withAmount.verified.amount && withAmount.verified.date, JSON.stringify(withAmount));
  const none = await lone(undefined, "invoices/v3.pdf");
  assert.ok(none.ok, JSON.stringify(none));
  assert.deepEqual(none.verified, { date: false, amount: false });
});

test("the row of a lone element stops short of the list that holds its look-alikes", { skip }, async () => {
  const { scripts } = await import("../src/page-scripts.ts");
  await driver!.navigate(`${base}list-chain.html`);
  const snap = (await driver!.evaluate(scripts.snapshot(50))) as { elements: { ref: string; name: string }[] };
  const chain = (await driver!.evaluate(scripts.rowChain(snap.elements.find((e) => e.name === "PDF")!.ref))) as string[];
  assert.deepEqual(chain, ["PDF", "PDF 3 Sep 2026"]);
});

const steps = (): ReplayStep[] => [
  { kind: "click", target: { role: "button", name: "Sign in" }, expect: { urlIncludes: "/home.html", text: "Welcome back" } },
  { kind: "click", target: { role: "link", name: "Billing" }, expect: { urlIncludes: "/billing.html" } },
  { kind: "navigate", url: `${base}list.html` },
  { kind: "download", target: { role: "link", name: "Download invoice" }, fileType: "pdf" },
];
const options = (path: string) => ({ driver: driver!, allowUrl: (u: string) => new URL(u).hostname === "127.0.0.1", domainRules: { allowedDomains: ["127.0.0.1"] }, downloadRoot: dir, downloadPath: path, confirmRisk: async () => true, expectTimeoutMs: 5000 });

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

const rowStep = (): ReplayStep => ({ kind: "download", target: { role: "link", name: "Download invoice", row: { match: ["date", "amount"] } }, fileType: "pdf" });
const rows = (invoice: { date: string; amount?: number; currency?: string }, path: string) => runReplay({ startUrl: `${base}list-months.html`, steps: [rowStep()] }, { ...options(path), invoice });

test("the row for the invoice date is downloaded, with date tolerance", { skip }, async () => {
  const r = await rows({ date: "2026-10-04" }, "invoices/r1.pdf");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(readFileSync(join(dir, "invoices/r1.pdf"), "latin1").includes("inv-2026-10"));
});

test("two rows on one date are told apart by amount, and left to the user without it", { skip }, async () => {
  const r = await rows({ date: "2026-11-03", amount: 99, currency: "EUR" }, "invoices/r2.pdf");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(readFileSync(join(dir, "invoices/r2.pdf"), "latin1").includes("inv-2026-11b"));
  const none = await rows({ date: "2026-11-03" }, "invoices/r3.pdf");
  assert.equal(!none.ok && none.reason, "row-ambiguous");
  assert.ok(!none.ok && none.detail.includes("2026-11-03"));
});

test("a date with no row hands off as row-not-found, and a missing invoice as needs-invoice", { skip }, async () => {
  const r = await rows({ date: "2026-12-20" }, "invoices/r4.pdf");
  assert.equal(!r.ok && r.reason, "row-not-found");
  const n = await runReplay({ startUrl: `${base}list-months.html`, steps: [rowStep()] }, options("invoices/r5.pdf"));
  assert.equal(!n.ok && n.reason, "needs-invoice");
});

test("a lone link whose row is not an explicit row element is never matched on its page text", { skip }, async () => {
  const r = await runReplay({ startUrl: `${base}list-single.html`, steps: [rowStep()] }, { ...options("invoices/r6.pdf"), invoice: { date: "2026-09-03" } });
  assert.equal(!r.ok && r.reason, "row-ambiguous");
});

test("a path recorded for one month's invoice replays for an invoice in another month", { skip }, async () => {
  // Record: pick a month, then download the second row, through the tools with onTrace, as a model would.
  const { registerBrowserTools } = await import("../src/tools.ts");
  const { pickRow } = await import("../src/replay.ts");
  const { matchPeriod } = await import("../src/row-match.ts");
  const trace: import("../src/tools.ts").BrowserTraceEntry[] = [];
  const tools = new Map<string, { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> }>();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver!, { keepPageViews: 0, downloadRoot: () => dir, onTrace: (e) => trace.push(e) });
  const call = async (name: string, params: Record<string, unknown> = {}) => (await tools.get(name)!.execute("t", params)).content.map((c) => c.text ?? "").join("\n");
  const refsOf = (snap: string, label: string) => [...snap.matchAll(new RegExp(`\\[?(e\\d+)\\]?[^\\n]*${label}`, "g"))].map((m) => m[1]!);
  await call("browser_navigate", { url: `${base}months.html` });
  await call("browser_click", { ref: refsOf(await call("browser_snapshot"), "October 2026")[0] });
  const list = await call("browser_snapshot");
  const links = refsOf(list, "Download invoice");
  assert.equal(links.length, 2);
  await call("browser_download", { ref: links[1], path: "invoices/rec.pdf" });
  const click = trace.find((t) => t.kind === "click") as Extract<typeof trace[number], { kind: "click" }>;
  const dl = trace.find((t) => t.kind === "download") as Extract<typeof trace[number], { kind: "download" }>;
  // The month click carries sibling labels; the download names its place in the list and no row-specific address.
  assert.equal(click.periodContext?.names.filter(Boolean).length, 3);
  assert.equal(dl.url, undefined);
  assert.equal(dl.rowContext?.clickedIndex, 1);
  // Save: the same checks the host makes for an invoice of 2026-10-20.
  const invoice = { date: "2026-10-20" };
  const labels = click.periodContext!.names.flatMap((text, index) => (text ? [{ index, text }] : []));
  assert.deepEqual(matchPeriod(labels, invoice), { kind: "one", index: click.periodContext!.clickedIndex });
  assert.deepEqual(pickRow(dl.rowContext!.texts.map((_, i) => String(i)), dl.rowContext!.texts, invoice, ["date"]), { target: "1", seen: { amount: false, matchedBy: ["date"], offsetDays: 0 } });
  const steps: ReplayStep[] = [
    { kind: "click", target: { role: click.locator.role, period: true } },
    { kind: "download", target: { role: dl.locator!.role, name: dl.locator!.name, row: { match: ["date"] } }, fileType: "pdf" },
  ];
  const r = await runReplay({ startUrl: `${base}months.html`, steps }, { ...options("invoices/rep.pdf"), invoice: { date: "2026-11-17" } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(readFileSync(join(dir, "invoices/rep.pdf"), "latin1").includes("inv-2026-11b"));
});

test("the shortcut address is opened directly, skipping sign-in; a page that is not the expected one falls back to the full path", { skip }, async () => {
  let asked = 0;
  const seen: string[] = [];
  const o = (path: string) => ({ ...options(path), expectTimeoutMs: 1500, confirmRisk: async () => (asked++, true), onStep: (i: number, s: string) => seen.push(`${i}:${s}`) });
  const direct = await runReplay({ startUrl: `${base}login.html`, steps: steps(), shortcut: { url: `${base}billing.html`, afterStep: 2 } }, o("invoices/s1.pdf"));
  assert.ok(direct.ok && direct.shortcut === "used", JSON.stringify(direct));
  assert.equal(asked, 0, "the sign-in click was not made");
  assert.deepEqual(seen.slice(0, 3), ["0:done", "1:done", "2:done"]);
  assert.ok(readFileSync(join(dir, "invoices/s1.pdf"), "latin1").startsWith("%PDF"));
  const stale = await runReplay({ startUrl: `${base}login.html`, steps: steps(), shortcut: { url: `${base}home.html`, afterStep: 2 } }, o("invoices/s2.pdf"));
  assert.ok(stale.ok && stale.shortcut === "failed", JSON.stringify(stale));
  assert.equal(asked, 1, "the full path ran, including the sign-in click");
});

test("a click that opens a new tab is followed, so the next step acts on the new page", { skip }, async () => {
  const before = new Set(((await (await fetch(`${CDP}/json/list`)).json()) as { id: string }[]).map((t) => t.id));
  await driver!.tabs(); // attach
  const stranger = (await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json()) as { id: string };
  assert.ok(!(await driver!.tabs()).some((t) => t.id === stranger.id), "a tab the driver did not attach to or see open is never listed");
  await assert.rejects(driver!.switchTab(stranger.id), /No tab/);
  await fetch(`${CDP}/json/close/${stranger.id}`);
  const r = await runReplay(
    { startUrl: `${base}opens-tab.html`, steps: [{ kind: "click", target: { role: "link", name: "Open invoice" } }, { kind: "download", target: { role: "link", name: "Download invoice" }, fileType: "pdf" }] },
    options("invoices/tab.pdf"),
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(readFileSync(join(dir, "invoices/tab.pdf"), "latin1").includes("inv-2026-09"));
  assert.ok((await driver!.state()).url.endsWith("/detail-tab.html"));
  // Leave no extra tab behind for the other tests.
  for (const t of (await (await fetch(`${CDP}/json/list`)).json()) as { id: string; type: string }[]) if (t.type === "page" && !before.has(t.id)) await fetch(`${CDP}/json/close/${t.id}`);
});

// The same server answers on a second origin (localhost), which a playbook may list as a second host.
const twoHosts = (path: string, hosts: string[]) => ({ ...options(path), allowUrl: (u: string) => hosts.includes(new URL(u).hostname), domainRules: { allowedDomains: ["127.0.0.1", "localhost"] } });
const hop = (verify: "row" | "page" | undefined, page = "opens-tab-x.html"): [{ startUrl: string; steps: ReplayStep[] }] => [{ startUrl: `${base}${page}`, steps: [{ kind: "click", target: { role: "link", name: "Open invoice" } }, { kind: "download", target: { role: "link", name: "Download invoice" }, fileType: "pdf", ...(verify ? { verify } : {}) }] }];
const closeExtraTabs = async (before: Set<string>) => {
  for (const t of (await (await fetch(`${CDP}/json/list`)).json()) as { id: string; type: string }[]) if (t.type === "page" && !before.has(t.id)) await fetch(`${CDP}/json/close/${t.id}`);
};
const openTabs = async () => new Set(((await (await fetch(`${CDP}/json/list`)).json()) as { id: string }[]).map((t) => t.id));

test("a click that opens a tab whose download button appears late is followed and the download completes", { skip }, async () => {
  const before = await openTabs();
  const r = await runReplay(
    { startUrl: `${base}late-window-open.html`, steps: [{ kind: "click", target: { role: "link", name: "Open invoice" }, opensTab: true }, { kind: "download", target: { role: "link", name: "Download invoice" }, fileType: "pdf" }] },
    options("invoices/late.pdf"),
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(readFileSync(join(dir, "invoices/late.pdf"), "latin1").startsWith("%PDF"));
  await closeExtraTabs(before);
});

test("a click whose window.open fires from a timer is still reported as an opened tab, and the driver is on it", { skip }, async () => {
  const before = await openTabs();
  const opened = await driver!.navigate(`${base}late-window-open.html`);
  assert.ok(!opened.note);
  const { runPageAction } = await import("../src/actions.ts");
  const snap = String((await runPageAction(driver!, { action: "snapshot" })).text);
  const ref = /\[(e\d+)\] link "Open invoice"/.exec(snap)![1]!;
  const r = await runPageAction(driver!, { action: "click", target: ref });
  assert.equal(r.openedTab, true, JSON.stringify(r));
  assert.ok((await driver!.state()).url.endsWith("/late-detail.html"));
  await closeExtraTabs(before);
});

test("a click that opens a tab on a listed second host is followed, and the detail page proves the invoice", { skip }, async () => {
  const before = await openTabs();
  const invoice = { date: "2026-09-03", amount: 49, currency: "EUR" };
  const r = await runReplay(...hop("page"), { ...twoHosts("invoices/x1.pdf", ["127.0.0.1", "localhost"]), invoice });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.verified, { date: true, amount: true, matchedBy: ["date", "amount"], offsetDays: 0 });
  assert.ok(readFileSync(join(dir, "invoices/x1.pdf"), "latin1").includes("inv-2026-09"));
  await closeExtraTabs(before);
});

test("a detail page that shows neither the invoice date nor its amount is handed off as ambiguous", { skip }, async () => {
  const before = await openTabs();
  const r = await runReplay(...hop("page", "opens-tab-x.html"), { ...twoHosts("invoices/x2.pdf", ["127.0.0.1", "localhost"]), invoice: { date: "2026-02-14", amount: 7, currency: "USD" } });
  assert.equal(!r.ok && r.reason, "ambiguous");
  assert.ok(!r.ok && r.detail.includes("neither"), JSON.stringify(r));
  assert.throws(() => readFileSync(join(dir, "invoices/x2.pdf")));
  await closeExtraTabs(before);
});

test("a second host that is not listed still ends the run as blocked", { skip }, async () => {
  const before = await openTabs();
  const r = await runReplay(...hop("page"), { ...twoHosts("invoices/x3.pdf", ["127.0.0.1"]), invoice: { date: "2026-09-03", amount: 49, currency: "EUR" } });
  assert.equal(!r.ok && r.reason, "blocked");
  assert.throws(() => readFileSync(join(dir, "invoices/x3.pdf")));
  await closeExtraTabs(before);
});
