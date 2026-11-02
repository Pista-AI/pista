import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { findBrowser } from "../src/chrome/find.ts";
import { launchBrowser, pistaChromeProfileDir, ProfileInUseError } from "../src/chrome/launch.ts";
import { PipeTransport } from "../src/chrome/pipe.ts";

const tick = () => new Promise((r) => setImmediate(r));

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdio = [null, null, null, new PassThrough(), new PassThrough()];
  child.kill = () => child.emit("exit", null, "SIGKILL");
  const sent: any[] = [];
  child.stdio[3].on("data", (d: Buffer) => d.toString().split("\0").filter(Boolean).forEach((m) => sent.push(JSON.parse(m))));
  return { child, sent, reply: (m: object) => child.stdio[4].write(JSON.stringify(m) + "\0") };
}

test("pipe: framing across chunk boundaries, id matching, events, close", async () => {
  const out = new PassThrough();
  const input = new PassThrough();
  const t = new PipeTransport(out, input);
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  const written: any[] = [];
  out.on("data", (d) => written.push(...d.toString().split("\0").filter(Boolean).map((s: string) => JSON.parse(s))));
  const a = t.send("A.one", { x: 1 }, "S1");
  const b = t.send("B.two");
  await tick();
  assert.deepEqual(written[0], { id: 1, method: "A.one", params: { x: 1 }, sessionId: "S1" });
  const second = JSON.stringify({ id: 2, result: { ok: 2 } });
  input.write(JSON.stringify({ id: 1, result: { ok: 1 } }) + "\0" + second.slice(0, 5));
  input.write(second.slice(5) + "\0" + JSON.stringify({ method: "E.ev", params: { p: 1 }, sessionId: "S1" }) + "\0");
  assert.deepEqual(await a, { ok: 1 });
  assert.deepEqual(await b, { ok: 2 });
  assert.deepEqual(events, [{ method: "E.ev", params: { p: 1 }, sessionId: "S1" }]);
  const c = t.send("C.three");
  input.write(JSON.stringify({ id: 3, error: { message: "nope" } }) + "\0");
  await assert.rejects(c, /nope/);
  const d = t.send("D.four");
  input.end();
  await assert.rejects(d, /pipe closed/);
  await assert.rejects(t.send("E"), /pipe closed/);
});

test("launch: args, profile dir mode, Browser.close on close()", async () => {
  const { child, sent, reply } = fakeChild();
  let call: any;
  let mkdirOpts: any;
  const b = await launchBrowser(
    { browserPath: "/bin/chrome", profileDir: "/p", extraArgs: ["--x"] },
    {
      spawn: (cmd, args, opts) => ((call = { cmd, args, opts }), child),
      readLink: () => { throw new Error("ENOENT"); },
      mkdir: (_p, o) => (mkdirOpts = o),
    },
  );
  assert.equal(call.cmd, "/bin/chrome");
  assert.deepEqual(call.opts.stdio, ["ignore", "ignore", "ignore", "pipe", "pipe"]);
  for (const a of ["--user-data-dir=/p", "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled", "--x"]) assert.ok(call.args.includes(a), a);
  assert.ok(!call.args.includes("--enable-automation"));
  assert.equal(mkdirOpts.mode, 0o700);
  const closing = b.close();
  await tick();
  assert.equal(sent[0].method, "Browser.close");
  reply({ id: sent[0].id, result: {} });
  child.emit("exit", 0, null);
  await closing;
});

test("launch: close() kills after the timeout", async () => {
  const { child } = fakeChild();
  let killed = false;
  child.kill = () => ((killed = true), child.emit("exit", null, "SIGKILL"));
  const b = await launchBrowser({ browserPath: "c", profileDir: "/p" }, { spawn: () => child, readLink: () => { throw new Error("x"); }, mkdir: () => {}, closeTimeoutMs: 10 });
  await b.close();
  assert.ok(killed);
});

test("launch: ProfileInUseError for a live lock, not for a stale one", async () => {
  const base = { spawn: () => fakeChild().child, readLink: () => "host-4242", mkdir: () => {} };
  await assert.rejects(launchBrowser({ browserPath: "c", profileDir: "/p" }, { ...base, isAlive: () => true }), ProfileInUseError);
  await launchBrowser({ browserPath: "c", profileDir: "/p" }, { ...base, isAlive: () => false });
});

test("launch: early exit rejects pending commands with a clear error", async () => {
  const { child } = fakeChild();
  const b = await launchBrowser({ browserPath: "c", profileDir: "/p" }, { spawn: () => child, readLink: () => { throw new Error("x"); }, mkdir: () => {} });
  const p = b.transport.send("Target.getTargets");
  child.emit("exit", 1, null);
  await assert.rejects(p, /exited unexpectedly \(code 1\)/);
});

test("find: per-platform discovery, order, prefer, override", () => {
  const has = (...paths: string[]) => (p: string) => paths.includes(p);
  assert.deepEqual(findBrowser({}, { platform: "darwin", home: "/h", exists: has("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/h/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") })?.kind, "chrome");
  assert.equal(findBrowser({ prefer: "edge" }, { platform: "darwin", home: "/h", exists: has("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") })?.kind, "edge");
  const win = findBrowser({}, { platform: "win32", env: { LOCALAPPDATA: "C:\\L", "PROGRAMFILES(X86)": "C:\\x86" }, exists: has("C:\\L\\BraveSoftware\\Brave-Browser\\Application\\brave.exe") });
  assert.deepEqual(win, { kind: "brave", path: "C:\\L\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" });
  assert.equal(findBrowser({}, { platform: "linux", env: { PATH: "/usr/bin:/bin" }, exists: has("/usr/bin/google-chrome-stable") })?.path, "/usr/bin/google-chrome-stable");
  assert.equal(findBrowser({}, { platform: "linux", env: { PATH: "" }, exists: has("/opt/microsoft/msedge/msedge") })?.kind, "edge");
  assert.equal(findBrowser({}, { platform: "linux", env: { PATH: "" }, exists: () => false }), null);
  assert.deepEqual(findBrowser({ overridePath: "/custom/b" }, { platform: "linux", exists: has("/custom/b", "/usr/bin/google-chrome") }), { kind: "chrome", path: "/custom/b" });
  assert.equal(findBrowser({ overridePath: "/missing" }, { platform: "linux", exists: () => false }), null);
});

test("pistaChromeProfileDir", () => assert.equal(pistaChromeProfileDir("/home/.pista"), "/home/.pista/chrome-profile"));

test("pipe: a throwing write rejects; throwing listeners do not break the stream", async () => {
  const out: any = new PassThrough();
  out.write = () => { throw new Error("EPIPE"); };
  const input = new PassThrough();
  const t = new PipeTransport(out, input);
  await assert.rejects(t.send("A"), /EPIPE/);
  const out2 = new PassThrough();
  const input2 = new PassThrough();
  const t2 = new PipeTransport(out2, input2);
  let later = 0;
  t2.onEvent(() => { throw new Error("boom"); });
  t2.onEvent(() => later++);
  input2.write(JSON.stringify({ method: "E.x" }) + "\0");
  await tick();
  assert.equal(later, 1);
  const p = t2.send("B");
  input2.write(JSON.stringify({ id: 1, result: 1 }) + "\0");
  assert.equal(await p, 1);
});

test("launch: minimal env, spawn error unblocks close(), win32 early exit 0 is ProfileInUse", async () => {
  const { child } = fakeChild();
  let env: any;
  const b = await launchBrowser({ browserPath: "c", profileDir: "/p" }, {
    spawn: (_c, _a, o) => ((env = o.env), child), readLink: () => { throw new Error("x"); }, mkdir: () => {}, platform: "linux",
    env: { HOME: "/h", PATH: "/bin", LC_ALL: "C", XDG_RUNTIME_DIR: "/r", OPENAI_API_KEY: "secret", SystemRoot: "C:\\W" },
  });
  assert.deepEqual(env, { HOME: "/h", PATH: "/bin", LC_ALL: "C", XDG_RUNTIME_DIR: "/r" });
  const closing = b.close();
  child.emit("error", new Error("ENOENT"));
  await closing;

  const w = fakeChild();
  const bw = await launchBrowser({ browserPath: "c", profileDir: "/p" }, { spawn: () => w.child, readLink: () => { throw new Error("x"); }, mkdir: () => {}, platform: "win32", env: {} });
  const p = bw.transport.send("X");
  w.child.emit("exit", 0, null);
  await assert.rejects(p, ProfileInUseError);
});

test("find: kind comes from the basename; snap, flatpak and PROGRAMW6432 paths", () => {
  assert.equal(findBrowser({ overridePath: "/home/edge-tools/chrome" }, { platform: "linux", exists: () => true })?.kind, "chrome");
  assert.equal(findBrowser({ overridePath: "C:\\x\\msedge.exe" }, { platform: "win32", exists: () => true })?.kind, "edge");
  assert.equal(findBrowser({ overridePath: "/usr/bin/brave-browser" }, { platform: "linux", exists: () => true })?.kind, "brave");
  const has = (p: string) => (q: string) => q === p;
  assert.equal(findBrowser({}, { platform: "linux", env: { PATH: "" }, exists: has("/snap/bin/chromium") })?.kind, "chrome");
  assert.equal(findBrowser({}, { platform: "linux", env: { PATH: "" }, exists: has("/var/lib/flatpak/exports/bin/com.brave.Browser") })?.kind, "brave");
  assert.equal(findBrowser({}, { platform: "win32", env: { PROGRAMW6432: "C:\\PF" }, exists: has("C:\\PF\\Google\\Chrome\\Application\\chrome.exe") })?.kind, "chrome");
});
