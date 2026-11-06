import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { findBrowser } from "../src/chrome/find.ts";
import { launchBrowser } from "../src/chrome/launch.ts";
import type { CdpEvent, CdpTransport } from "../src/chrome/pipe.ts";
import { ChromeDriver } from "../src/drivers/chrome.ts";
import { runPageAction } from "../src/actions.ts";
import { registerBrowserTools, type BrowserTraceEntry } from "../src/tools.ts";

const tick = () => new Promise((r) => setImmediate(r));

/** A scripted browser: records every call, answers the ones the driver needs, and lets a test push events. */
function fakeBrowser(onSend?: (method: string, params: any) => any) {
  const calls: { method: string; params: any; sessionId?: string }[] = [];
  const events: ((e: CdpEvent) => void)[] = [];
  const closers: ((e: Error) => void)[] = [];
  const transport: CdpTransport = {
    async send(method, params = {}, sessionId) {
      calls.push({ method, params, sessionId });
      const custom = onSend?.(method, params);
      if (custom !== undefined) return custom;
      if (method === "Target.createTarget") return { targetId: "T1" };
      if (method === "Target.attachToTarget") return { sessionId: "S1" };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "F1" } } };
      if (method === "Page.navigate") return {};
      if (method === "Runtime.evaluate") return { result: { value: { url: "https://example.com/", title: "Example" } } };
      return {};
    },
    onEvent: (h) => void events.push(h),
    onClose: (h) => void closers.push(h),
    close: () => {},
  };
  return {
    transport,
    calls,
    emit: (e: CdpEvent) => events.forEach((h) => h(e)),
    die: () => closers.splice(0).forEach((h) => h(new Error("gone"))),
  };
}

function driverWith(browsers: ReturnType<typeof fakeBrowser>[], rules?: { deniedDomains?: string[]; allowedDomains?: string[] }) {
  let launches = 0;
  const driver = new ChromeDriver(
    { pistaHome: "/nowhere", domainRules: rules },
    {
      find: () => ({ kind: "chrome", path: "/fake/chrome" }),
      launch: (async () => ({ transport: browsers[launches++].transport, process: {}, close: async () => {} })) as any,
    },
  );
  return { driver, launches: () => launches };
}

test("launches lazily, attaches to the page and navigates", async () => {
  const b = fakeBrowser();
  const { driver, launches } = driverWith([b]);
  assert.equal(launches(), 0);
  const state = await driver.navigate("https://example.com/");
  assert.equal(launches(), 1);
  assert.equal(state.title, "Example");
  const nav = b.calls.find((c) => c.method === "Page.navigate")!;
  assert.equal(nav.sessionId, "S1");
  assert.ok(b.calls.some((c) => c.method === "Browser.setDownloadBehavior" && c.params.behavior === "deny"));
  assert.ok(!b.calls.some((c) => c.method === "Fetch.enable"), "no rules, no interception");
});

test("denied documents are failed with BlockedByClient, allowed ones continue", async () => {
  const b = fakeBrowser();
  const { driver } = driverWith([b], { deniedDomains: ["evil.com"] });
  await driver.state();
  assert.ok(b.calls.some((c) => c.method === "Fetch.enable" && c.sessionId === "S1"));
  b.emit({ method: "Fetch.requestPaused", sessionId: "S1", params: { requestId: "r1", request: { url: "https://evil.com/x" } } });
  b.emit({ method: "Fetch.requestPaused", sessionId: "S1", params: { requestId: "r2", request: { url: "https://example.com/" } } });
  await tick();
  assert.deepEqual(b.calls.find((c) => c.method === "Fetch.failRequest")?.params, { requestId: "r1", errorReason: "BlockedByClient" });
  assert.deepEqual(b.calls.find((c) => c.method === "Fetch.continueRequest")?.params, { requestId: "r2" });
});

test("relaunches on the next use after the browser is closed", async () => {
  const first = fakeBrowser();
  const second = fakeBrowser();
  const { driver, launches } = driverWith([first, second]);
  await driver.state();
  first.die();
  await driver.state();
  assert.equal(launches(), 2);
  assert.ok(second.calls.some((c) => c.method === "Runtime.evaluate"));
});

test("a closed tab is replaced in the same browser", async () => {
  const b = fakeBrowser();
  const { driver, launches } = driverWith([b]);
  await driver.state();
  b.emit({ method: "Target.detachedFromTarget", params: { sessionId: "S1" } });
  await driver.state();
  assert.equal(launches(), 1);
  assert.equal(b.calls.filter((c) => c.method === "Target.attachToTarget").length, 2);
});

test("browser not found is a clear error", async () => {
  const driver = new ChromeDriver({ pistaHome: "/nowhere" }, { find: () => null });
  await assert.rejects(driver.state(), /No Chrome, Edge or Brave browser was found/);
});

test("a triggered download is saved into the target folder and moved to the path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chrome-driver-"));
  try {
    const b = fakeBrowser();
    const { driver } = driverWith([b]);
    const target = join(dir, "invoices", "a.pdf");
    const saved = await driver.download({
      path: target,
      trigger: async () => {
        // The browser names the file by guid inside the folder it was told to use.
        const behavior = b.calls.find((c) => c.method === "Browser.setDownloadBehavior" && c.params.behavior === "allowAndName")!;
        assert.equal(behavior.params.downloadPath, join(dir, "invoices"));
        writeFileSync(join(behavior.params.downloadPath, "guid-1"), "pdf!");
        b.emit({ method: "Browser.downloadWillBegin", params: { guid: "guid-1", url: "https://example.com/a.pdf" } });
        b.emit({ method: "Browser.downloadProgress", params: { guid: "guid-1", state: "completed" } });
      },
    });
    assert.equal(readFileSync(target, "utf8"), "pdf!");
    assert.deepEqual(saved, { bytes: 4, urlChain: ["https://example.com/a.pdf"] });
    assert.equal(b.calls.at(-1)!.params.behavior, "deny");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function server(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void) {
  return new Promise<{ base: string; close: () => void }>((resolve) => {
    const srv = createServer(handler).listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(srv.address() as any).port}`, close: () => srv.close() }));
  });
}

test("a download by address streams to the path; a redirect hop to a denied host is blocked and leaves no file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chrome-driver-"));
  const srv = await server((req, res) => {
    if (req.url === "/ok") (res.writeHead(200, { "content-type": "text/plain" }), res.end("hello"));
    else (res.writeHead(302, { location: "http://denied.test/secret" }), res.end());
  });
  try {
    const b = fakeBrowser((method) => (method === "Network.getCookies" ? { cookies: [] } : method === "Runtime.evaluate" ? { result: { value: "UA" } } : undefined));
    const { driver } = driverWith([b], { deniedDomains: ["denied.test"] });
    const ok = await driver.download({ path: join(dir, "x.txt"), url: `${srv.base}/ok` });
    assert.equal(readFileSync(join(dir, "x.txt"), "utf8"), "hello");
    assert.deepEqual(ok, { bytes: 5, contentType: "text/plain", urlChain: [`${srv.base}/ok`] });
    await assert.rejects(driver.download({ path: join(dir, "y.txt"), url: `${srv.base}/redir` }), /denied/);
    assert.equal(existsSync(join(dir, "y.txt")), false);
    await assert.rejects(driver.download({ path: join(dir, "x.txt"), url: `${srv.base}/ok` }), /EEXIST/); // never overwrites or follows a planted file
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setup failure fails closed: the tab is closed and the next call retries setup", async () => {
  let failures = 1;
  const b = fakeBrowser((method) => {
    if (method === "Fetch.enable" && failures-- > 0) throw new Error("boom");
  });
  const { driver } = driverWith([b], { deniedDomains: ["evil.com"] });
  await assert.rejects(driver.state(), /boom/);
  assert.ok(b.calls.some((c) => c.method === "Target.closeTarget" && c.params.targetId === "T1"));
  assert.ok(!b.calls.some((c) => c.method === "Runtime.evaluate"), "nothing ran on the unguarded page");
  await driver.state();
  assert.equal(b.calls.filter((c) => c.method === "Fetch.enable").length, 2);
});

test("popups, frames and workers are guarded before they run; their requests are checked", async () => {
  const b = fakeBrowser();
  const { driver } = driverWith([b], { deniedDomains: ["evil.com"] });
  await driver.state();
  assert.ok(b.calls.some((c) => c.method === "Target.setAutoAttach" && c.sessionId === "S1" && c.params.waitForDebuggerOnStart === true));
  assert.ok(b.calls.some((c) => c.method === "Target.setAutoAttach" && c.sessionId === undefined), "browser-level auto-attach catches popups");
  b.emit({ method: "Target.attachedToTarget", params: { sessionId: "S2", targetInfo: { targetId: "T2", type: "page" } } });
  await tick();
  await tick();
  const order = b.calls.filter((c) => c.sessionId === "S2").map((c) => c.method);
  assert.deepEqual(order, ["Target.setAutoAttach", "Fetch.enable", "Runtime.runIfWaitingForDebugger"]);
  b.emit({ method: "Fetch.requestPaused", sessionId: "S2", params: { requestId: "p1", request: { url: "https://evil.com/" } } });
  await tick();
  assert.ok(b.calls.some((c) => c.method === "Fetch.failRequest" && c.sessionId === "S2" && c.params.requestId === "p1"));
});

test("a popup that cannot be guarded is closed", async () => {
  const b = fakeBrowser((method, _p) => {
    if (method === "Fetch.enable" && b.calls.some((c) => c.sessionId === "S2")) throw new Error("no");
  });
  const { driver } = driverWith([b], { deniedDomains: ["evil.com"] });
  await driver.state();
  b.emit({ method: "Target.attachedToTarget", params: { sessionId: "S2", targetInfo: { targetId: "T2", type: "page" } } });
  await tick();
  await tick();
  assert.ok(b.calls.some((c) => c.method === "Target.closeTarget" && c.params.targetId === "T2"));
});

test("tabs lists only our tabs, switching reuses the session, and closing a tab goes back to its opener", async () => {
  const infos = [
    { targetId: "T1", type: "page", url: "https://a.test/", title: "A" },
    { targetId: "T2", type: "page", url: "https://a.test/two", title: "Two", openerId: "T1" },
    { targetId: "T9", type: "page", url: "https://restored.test/", title: "Restored" },
    { targetId: "W1", type: "service_worker", url: "https://a.test/sw.js", title: "" },
  ];
  const b = fakeBrowser((method, params) => {
    if (method === "Target.getTargets") return { targetInfos: infos };
    if (method === "Target.attachToTarget") return { sessionId: `S-${params.targetId}` };
    if (method === "Target.createTarget") return { targetId: "T1" };
  });
  const { driver } = driverWith([b]);
  assert.deepEqual((await driver.tabs()).map((t) => [t.id, t.active]), [["T1", true], ["T2", false]]);
  const watched = await driver.watchNewTabs();
  assert.deepEqual(await watched(), [], "nothing new yet");
  await driver.switchTab("T2");
  await assert.rejects(driver.switchTab("T9"), /No tab/);
  assert.equal(b.calls.filter((c) => c.method === "Page.enable").at(-1)!.sessionId, "S-T2");
  assert.deepEqual((await driver.tabs()).map((t) => t.active), [false, true]);
  // The tab closes: the next use is on the tab that opened it, on its old session, not on a new tab.
  b.emit({ method: "Target.detachedFromTarget", params: { sessionId: "S-T2" } });
  infos.splice(1, 1);
  await driver.state();
  assert.equal(b.calls.filter((c) => c.method === "Target.createTarget").length, 1);
  assert.equal(b.calls.filter((c) => c.method === "Target.attachToTarget").length, 2);
  assert.equal(b.calls.filter((c) => c.method === "Page.enable").at(-1)!.sessionId, "S-T1");
});

// The same, against a real Chrome (headless, over the same private pipe the app uses). Skipped where no Chrome is installed.
const noChrome = findBrowser({}) ? false : "no Chrome, Edge or Brave browser is installed";
test("a click that opens a new tab is followed, listed and switchable, traced, and closing it returns to the first tab", { skip: noChrome }, async () => {
  const srv = await server((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/second" ? "<title>Second</title><h1>Second page</h1><button>Go</button>" : '<title>First</title><a target="_blank" href="/second">Open second</a><a href="/second">Same tab</a>');
  });
  const home = mkdtempSync(join(tmpdir(), "chrome-tabs-"));
  const driver = new ChromeDriver({ pistaHome: home }, { launch: (o) => launchBrowser(o, { spawn: (cmd, args, opts) => spawn(cmd, [...args, "--headless=new"], opts) }) });
  try {
    await driver.navigate(`${srv.base}/`);
    const ref = async (name: string) => {
      const snap = (await runPageAction(driver, { action: "snapshot" })).text!;
      return new RegExp(`\\b(e\\d+)\\b[^\\n]*${name}`).exec(snap)![1]!;
    };
    const clicked = await runPageAction(driver, { action: "click", target: await ref("Open second") });
    assert.match(clicked.outcome!, /Clicked .*Opened a new tab: .*\/second/);
    assert.equal(clicked.openedTab, true);
    assert.match(clicked.text!, /Go/, "the snapshot is of the new tab");
    const tabs = await driver.tabs();
    assert.equal(tabs.length, 2);
    assert.deepEqual(tabs.map((t) => t.active), [false, true]);
    assert.ok((await driver.state()).url.endsWith("/second"));
    // A link in the same tab opens no tab.
    await driver.switchTab(tabs[0]!.id);
    const same = await runPageAction(driver, { action: "click", target: await ref("Same tab") });
    assert.ok(!same.openedTab && !/new tab/.test(same.outcome!), same.outcome);
    await driver.navigate(`${srv.base}/`);

    // The tools: a click traces openedTab with the new tab's address; browser_tabs lists and switches.
    const tools = new Map<string, { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> }>();
    const trace: BrowserTraceEntry[] = [];
    registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver, { keepPageViews: 0, onTrace: (e) => trace.push(e) });
    const call = async (name: string, params: Record<string, unknown> = {}) => {
      const res = await tools.get(name)!.execute("t", params);
      return { meta: JSON.parse(res.content[0]!.text!), body: res.content[1]?.text ?? "" };
    };
    const open = await call("browser_click", { ref: await ref("Open second") });
    assert.match(open.meta.result, /Opened a new tab/);
    const entry = trace.at(-1)!;
    assert.ok(entry.kind === "click" && entry.openedTab === true && entry.urlAfter.endsWith("/second"), JSON.stringify(entry));
    const listed = (await call("browser_tabs")).meta.tabs as { tab: number; url: string; active: boolean }[];
    assert.deepEqual(listed.map((t) => t.active), [false, false, true]);
    assert.equal(listed.length, 3, "the earlier second tab is still open");
    const back = await call("browser_tabs", { select: "1" });
    assert.ok(back.meta.url.endsWith("/") && /Open second/.test(back.body), "the snapshot after the switch shows the first page");
    const forward = await call("browser_tabs", { select: String(listed[2]!.tab) });
    assert.ok(forward.meta.url.endsWith("/second") && /Go/.test(forward.body));
    assert.match((await call("browser_tabs", { select: "9" })).meta.note, /No tab/);

    // Closing the active tab makes its opener the active one again.
    const active = (await driver.tabs()).find((t) => t.active)!;
    await (driver as any).browser.transport.send("Target.closeTarget", { targetId: active.id });
    for (let i = 0; i < 40 && (driver as any).conn; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok((await driver.state()).url.endsWith("/"), "back on the first tab");
    assert.equal((await driver.tabs()).filter((t) => t.active).length, 1);
  } finally {
    await driver.closeGracefully();
    srv.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("onClosed fires once when the browser goes away, and not after unsubscribing", async () => {
  const first = fakeBrowser();
  const second = fakeBrowser();
  const { driver } = driverWith([first, second]);
  let closed = 0;
  const off = driver.onClosed(() => closed++);
  await driver.state();
  first.die();
  assert.equal(closed, 1);
  off();
  await driver.state();
  second.die();
  assert.equal(closed, 1);
});

test("bringToFront is false while no browser is running", async () => {
  const b = fakeBrowser();
  const { driver, launches } = driverWith([b]);
  assert.equal(await driver.bringToFront(), false);
  assert.equal(launches(), 0);
});
