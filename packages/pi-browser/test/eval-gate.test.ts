import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { LOGIN_ORIGINS_SQL, readLoginOrigins, sqliteQuery } from "../src/chrome/login-origins.ts";
import type { CdpEvent, CdpTransport } from "../src/chrome/pipe.ts";
import type { BrowserDriver, DocumentProbe } from "../src/driver.ts";
import { ChromeDriver } from "../src/drivers/chrome.ts";
import { internalPageReason, registrableSite } from "../src/eval-gate.ts";
import { registerBrowserTools } from "../src/tools.ts";

type Tool = { execute: (...a: unknown[]) => Promise<{ content: { text?: string }[] }> };

/** A driver whose probe answers come from `doc`; counts evaluations, reloads and navigations. */
function fake(doc: { url: string; documentId: string; secret: boolean }, extra: Partial<BrowserDriver> = {}) {
  const log = { evals: 0, reloads: 0, navigations: [] as string[] };
  const driver = {
    probe: async (): Promise<DocumentProbe> => ({ ...doc }),
    state: async () => ({ url: doc.url, title: "", loading: false }),
    evaluate: async () => (log.evals++, { ok: true, text: '"fine"' }),
    reload: async () => void log.reloads++,
    navigate: async (u: string) => (log.navigations.push(u), { url: u, title: "", loading: false }),
    bringToFront: async () => true,
    ...extra,
  } as unknown as BrowserDriver;
  const tools = new Map<string, Tool>();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver, { keepPageViews: 0, traceDir: "off" });
  return { doc, log, tools, run: (name: string, args: object = {}) => tools.get(name)!.execute("1", args, undefined) };
}

test("login origins: only the two address columns are queried, from a copy, in both database files", async () => {
  const profile = mkdtempSync(join(tmpdir(), "pista-gate-test-"));
  try {
    mkdirSync(join(profile, "Default"), { recursive: true });
    writeFileSync(join(profile, "Default", "Login Data"), "x");
    writeFileSync(join(profile, "Default", "Login Data For Account"), "y");
    const seen: { path: string; sql: string }[] = [];
    const origins = await readLoginOrigins(profile, {
      query: async (path, sql) => (seen.push({ path, sql }), [{ origin_url: "https://example.com/login", signon_realm: "https://example.com/" }, { origin_url: "", signon_realm: "android://abc@com.app/" }]),
    });
    assert.deepEqual(origins, ["https://example.com"]);
    assert.equal(seen.length, 2);
    for (const s of seen) {
      assert.equal(s.sql, LOGIN_ORIGINS_SQL);
      assert.doesNotMatch(s.sql, /password_value|username_value|\*/i);
      assert.ok(!s.path.startsWith(profile)); // a copy, not Chrome's own file
    }
    assert.deepEqual(await readLoginOrigins(join(profile, "none"), { query: async () => assert.fail("no database") }), []);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test("browser_eval is refused on the site of a saved login, also on a sibling subdomain, and runs elsewhere", async () => {
  const f = fake({ url: "https://accounts.example.com/home", documentId: "d1", secret: false }, { savedLoginOrigins: async () => ["https://example.com"] });
  await assert.rejects(f.run("browser_eval", { script: "1" }), /disabled on sites with saved logins.*browser_snapshot/);
  assert.equal(f.log.evals, 0);
  f.doc.url = "https://other.org/";
  assert.match((await f.run("browser_eval", { script: "1" })).content[1]!.text!, /fine/);
  assert.equal(registrableSite("https://a.b.example.co.uk:8443/x"), "example.co.uk");
  assert.notEqual(registrableSite("https://example.org"), registrableSite("https://example.com"));
});

test("saved logins are cached for a minute", async () => {
  let reads = 0;
  const f = fake({ url: "https://other.org/", documentId: "d1", secret: false }, { savedLoginOrigins: async () => (reads++, []) });
  await f.run("browser_eval", { script: "1" });
  await f.run("browser_eval", { script: "2" });
  assert.equal(reads, 1);
});

test("once a password field was seen, the origin stays closed to browser_eval", async () => {
  const f = fake({ url: "https://shop.test/login", documentId: "d1", secret: true });
  await assert.rejects(f.run("browser_eval", { script: "1" }), /sign-in form was seen/);
  f.doc.secret = false; // the form is gone, the origin stays blocked
  f.doc.documentId = "d2";
  await assert.rejects(f.run("browser_eval", { script: "1" }), /sign-in form was seen/);
  f.doc.url = "https://elsewhere.test/";
  assert.match((await f.run("browser_eval", { script: "1" })).content[1]!.text!, /fine/);
});

test("a password field in a document a script ran in reloads it and drops what the tool read", async () => {
  const f = fake({ url: "https://spa.test/", documentId: "d1", secret: false }, { evaluate: (async () => ({ ok: true, text: '"x"' })) as never });
  await f.run("browser_eval", { script: "1" });
  f.doc.secret = true; // the SPA now renders a sign-in form
  const out = await f.run("browser_read", {}).catch((e) => e);
  assert.equal(f.log.reloads, 1);
  assert.match(JSON.stringify(out), /reloaded because a sign-in form appeared/);
  assert.doesNotMatch(JSON.stringify(out), /fine/);
  await assert.rejects(f.run("browser_eval", { script: "1" }), /sign-in form was seen/);
});

test("a password field in a document no script ran in is not reloaded", async () => {
  const f = fake({ url: "https://plain.test/", documentId: "d1", secret: true });
  await f.run("browser_screenshot", {}).catch(() => undefined);
  assert.equal(f.log.reloads, 0);
});

test("handing the browser over reloads any document a script ran in, and forgets the saved-login cache", async () => {
  let reads = 0;
  const f = fake({ url: "https://spa.test/", documentId: "d1", secret: false }, { savedLoginOrigins: async () => (reads++, []) });
  await f.run("browser_show_user");
  assert.equal(f.log.reloads, 0); // no script ran: nothing to undo
  await f.run("browser_eval", { script: "1" });
  assert.match(JSON.parse((await f.run("browser_show_user")).content[0]!.text!).note, /reloaded first/);
  assert.equal(f.log.reloads, 1);
  f.doc.documentId = "d2"; // the reloaded document is clean
  await f.run("browser_eval", { script: "1" });
  assert.equal(reads, 2); // cache dropped on handoff
  f.doc.documentId = "d3";
  await f.run("browser_show_user");
  assert.equal(f.log.reloads, 1);
});

test("browser-internal pages cannot be opened or used", async () => {
  for (const url of ["chrome://settings", "chrome-extension://abc/x.html", "devtools://devtools/bundled/inspector.html", "view-source:https://a.test/", "about:config", "javascript:alert(1)"]) assert.ok(internalPageReason(url), url);
  for (const url of ["about:blank", "https://a.test/", "chrome-error://chromewebdata/", ""]) assert.equal(internalPageReason(url), undefined, url);
  const f = fake({ url: "https://a.test/", documentId: "d1", secret: false });
  await assert.rejects(f.run("browser_navigate", { url: "chrome://settings/passwords" }), /off limits/);
  assert.deepEqual(f.log.navigations, []);
  f.doc.url = "chrome://settings/";
  await assert.rejects(f.run("browser_read"), /off limits/);
  await assert.rejects(f.run("browser_eval", { script: "1" }), /off limits/);
  await f.run("browser_navigate", { url: "https://a.test/" }).catch(() => undefined); // the way out stays open
  assert.ok(f.log.navigations.some((u) => new URL(u).host === "a.test"));
});

test("browser_download runs under the gate: a browser-internal page is off limits", async () => {
  const driver = { probe: async () => ({ url: "chrome://settings/", documentId: "d1", secret: false }), state: async () => ({ url: "chrome://settings/", title: "", loading: false }), download: async () => ({ bytes: 1 }) } as unknown as BrowserDriver;
  const tools = new Map<string, Tool>();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver, { keepPageViews: 0, traceDir: "off", downloadRoot: () => "/tmp/pista-gate-test" });
  await assert.rejects(tools.get("browser_download")!.execute("1", { url: "https://a.test/x.pdf", path: "x.pdf" }, undefined), /off limits/);
});

/** A scripted Chrome whose main world is "patched" to deny everything; only the isolated world tells the truth. */
function chromeWith(frameTree: () => object) {
  const calls: { method: string; params: any }[] = [];
  const transport: CdpTransport = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === "Target.createTarget") return { targetId: "T1" };
      if (method === "Target.attachToTarget") return { sessionId: "S1" };
      if (method === "Page.getFrameTree") return { frameTree: frameTree() };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 70 + calls.filter((c) => c.method === method).length };
      if (method === "Runtime.evaluate") return { result: { value: params.contextId === undefined ? false : true } };
      return {};
    },
    onEvent: (_h: (e: CdpEvent) => void) => {},
    onClose: () => {},
    close: () => {},
  };
  const driver = new ChromeDriver({ pistaHome: "/nowhere" }, { find: () => ({ kind: "chrome", path: "/fake" }), launch: (async () => ({ transport, process: {}, close: async () => {} })) as any });
  return { driver, calls };
}

test("the password check runs in an isolated world per frame document, so main-world patches do not matter", async () => {
  let loaderId = "L1";
  const { driver, calls } = chromeWith(() => ({ frame: { id: "F1", loaderId, url: "https://a.test/", urlFragment: "#x" }, childFrames: [{ frame: { id: "F2", loaderId: "C1", url: "https://a.test/f" } }] }));
  const first = await driver.probe();
  assert.deepEqual(first, { url: "https://a.test/#x", documentId: "F1:L1", secret: true });
  const created = () => calls.filter((c) => c.method === "Page.createIsolatedWorld");
  assert.deepEqual(created().map((c) => c.params.frameId), ["F1", "F2"]);
  const evals = calls.filter((c) => c.method === "Runtime.evaluate");
  assert.ok(evals.length === 2 && evals.every((c) => typeof c.params.contextId === "number"));
  await driver.probe();
  assert.equal(created().length, 2); // cached while the document stays
  loaderId = "L2";
  assert.equal((await driver.probe()).documentId, "F1:L2");
  assert.equal(created().length, 3); // a new document gets a new world
  assert.equal((await driver.evaluate("1")), false); // the main world, as the page patched it, says no
});

test("the chrome driver refuses to navigate to browser-internal pages", async () => {
  const { driver, calls } = chromeWith(() => ({ frame: { id: "F1", loaderId: "L", url: "about:blank" } }));
  await assert.rejects(driver.navigate("chrome://settings"), /off limits/);
  assert.ok(!calls.some((c) => c.method === "Page.navigate"));
});

test("browser_fill runs under the gate: a sign-in form appearing in a script-touched document reloads it", async () => {
  const f = fake({ url: "https://spa.test/", documentId: "d1", secret: false });
  assert.ok(f.tools.has("browser_fill"));
  await f.run("browser_eval", { script: "1" });
  f.doc.secret = true;
  const out = await f.run("browser_fill", { fields: [] }).catch((e) => e);
  assert.equal(f.log.reloads, 1);
  assert.match(JSON.stringify(out), /reloaded because a sign-in form appeared/);
  f.doc.url = "chrome://settings/";
  await assert.rejects(f.run("browser_fill", { fields: [] }), /off limits/);
});

test("a redirect while the script starts: the token is missing in the new document, nothing runs, the result is dropped", async () => {
  const probes: { token?: string; clearToken?: boolean }[] = [];
  const scripts: string[] = [];
  const f = fake({ url: "https://a.test/", documentId: "d1", secret: false }, {
    savedLoginOrigins: async () => ["https://saved.test"],
    probe: (async (opts: any = {}) => (probes.push(opts), { ...f.doc }) ) as never,
    evaluate: (async (script: string) => {
      scripts.push(script);
      // the page redirected to a saved-login site before the script started: the token is not on that document
      Object.assign(f.doc, { url: "https://saved.test/", documentId: "d2" });
      return { ok: false, text: "", navigated: true };
    }) as never,
  });
  const out = await f.run("browser_eval", { script: "1" });
  assert.match(JSON.stringify(out), /navigated while the script was starting/);
  const token = probes.find((o) => o.token)!.token!;
  assert.ok(token && scripts.length === 1 && scripts[0]!.includes(token) && scripts[0]!.includes("data-pista-eval")); // the main-world script checks for the token first
  assert.ok(probes.some((o) => o.clearToken)); // and the token is removed again
  assert.equal(f.log.reloads, 1); // the new page is a saved-login site
  await assert.rejects(f.run("browser_eval", { script: "1" }), /saved logins/);
});

test("the isolated-world probe writes and clears the token; no Runtime.enable is ever sent", async () => {
  const { driver, calls } = chromeWith(() => ({ frame: { id: "F1", loaderId: "L1", url: "https://a.test/" } }));
  await driver.probe({ token: "tok-123" });
  await driver.probe({ clearToken: true });
  const exprs = calls.filter((c) => c.method === "Runtime.evaluate").map((c) => String(c.params.expression));
  assert.ok(exprs[0]!.includes("tok-123"));
  assert.ok(!calls.some((c) => c.method === "Runtime.enable"));
});

test("scripts only run on http(s) origins; blob: URLs belong to their creator's site", async () => {
  const f = fake({ url: "data:text/html,hi", documentId: "d1", secret: false });
  await assert.rejects(f.run("browser_eval", { script: "1" }), /only run on http/);
  assert.equal(registrableSite("blob:https://app.example.com/1234"), "example.com");
});

test("registrableSite edge cases", () => {
  assert.equal(registrableSite("https://a.github.io/x"), "github.io"); // over-blocks every github.io page: no public-suffix list
  assert.equal(registrableSite("https://www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(registrableSite("http://192.168.1.5:3000/"), "192.168.1.5");
  assert.equal(registrableSite("http://[::1]:8080/"), "[::1]");
  assert.equal(registrableSite("http://localhost:3000"), "localhost");
  assert.equal(registrableSite("https://shop.bücher.example/"), "xn--bcher-kva.example");
  assert.equal(registrableSite("https://EXAMPLE.com./"), "example.com");
});

test("readLoginOrigins on a real SQLite database with a WAL: origin columns only, temp copy removed", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const profile = mkdtempSync(join(tmpdir(), "pista-gate-test-"));
  try {
    mkdirSync(join(profile, "Default"), { recursive: true });
    const db = new DatabaseSync(join(profile, "Default", "Login Data"));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE logins (origin_url TEXT, signon_realm TEXT, username_value TEXT, password_value BLOB)");
    db.prepare("INSERT INTO logins VALUES (?,?,?,?)").run("https://shop.test/login", "https://shop.test/", "ann", Buffer.from("SECRET-BLOB"));
    // the database stays open, as Chrome keeps it, so the row may sit only in the WAL
    const seen: { path: string; sql: string; rows: string }[] = [];
    const origins = await readLoginOrigins(profile, {
      query: async (path, sql) => {
        const rows = await sqliteQuery(path, sql);
        seen.push({ path, sql, rows: JSON.stringify(rows) });
        return rows;
      },
    });
    db.close();
    assert.deepEqual(origins, ["https://shop.test"]);
    assert.equal(seen[0]!.sql, LOGIN_ORIGINS_SQL);
    assert.doesNotMatch(seen[0]!.rows, /ann|SECRET/); // only the origin columns came back
    assert.equal(existsSync(dirname(seen[0]!.path)), false); // the temp copy is gone
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});
