import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHealth, resolveUpdaterConfig, UpdateController, type UpdaterConfig, type UpdaterLike } from "../src/updater-core.ts";

const base = { isPackaged: true, platform: "darwin", hasAppUpdateYml: true, summary: { enabled: true, channel: "stable" as const } };

test("config is off for dev, other platforms, missing or disabled summary, and no feed", () => {
  assert.equal(resolveUpdaterConfig({ ...base, isPackaged: false }).enabled, false);
  assert.equal(resolveUpdaterConfig({ ...base, platform: "win32" }).enabled, false);
  assert.equal(resolveUpdaterConfig({ ...base, summary: undefined }).enabled, false);
  assert.equal(resolveUpdaterConfig({ ...base, summary: { enabled: false, channel: "stable" } }).enabled, false);
  assert.equal(resolveUpdaterConfig({ ...base, hasAppUpdateYml: false }).enabled, false);
});

test("config selection: feedUrl, channel, checkNow", () => {
  assert.deepEqual(resolveUpdaterConfig(base), { enabled: true, channel: "latest", checkNow: false });
  const feed = resolveUpdaterConfig({ ...base, hasAppUpdateYml: false, summary: { enabled: true, channel: "beta", feedUrl: "https://u.example/p", enforcementHours: 8 }, gate: { status: "below", current: "1.0.0" } });
  assert.deepEqual(feed, { enabled: true, feedUrl: "https://u.example/p", channel: "beta", enforcementHours: 8, checkNow: true });
});

function harness() {
  const calls: string[] = [];
  const listeners: Record<string, (...a: any[]) => void> = {};
  const updater: UpdaterLike & { feed?: unknown; channelSets: number } = {
    autoDownload: false, autoInstallOnAppQuit: false, disableWebInstaller: false, allowDowngrade: false, channelSets: 0,
    _channel: null,
    get channel() { return (this as any)._channel; },
    set channel(v: string | null) { (this as any)._channel = v; this.channelSets++; this.allowDowngrade = true; },
    setFeedURL(o: unknown) { this.feed = o; },
    checkForUpdates() { calls.push("check"); return Promise.resolve(); },
    quitAndInstall() { calls.push("install"); },
    on(e: string, cb: (...a: any[]) => void) { listeners[e] = cb; return this; },
  } as any;
  let now = 0;
  const timeouts: { fn: () => void; ms: number }[] = [];
  const intervals: number[] = [];
  const timers = { now: () => now, setTimeout: (fn: () => void, ms: number) => (timeouts.push({ fn, ms }), timeouts.length), setInterval: (_f: () => void, ms: number) => (intervals.push(ms), 1), unref() {} };
  let answer: "now" | "later" = "later";
  let asks = 0;
  const prompt = { askRestart: async () => (asks++, answer), forceRestart: async () => void calls.push("force") };
  const controller = new UpdateController({ updater, prompt, timers, log: (m) => calls.push(`log:${m}`) });
  return { asks: () => asks, calls, listeners, updater, timeouts, intervals, controller, setNow: (n: number) => (now = n), setAnswer: (a: "now" | "later") => (answer = a) };
}
const tick = () => new Promise((r) => setImmediate(r));
const on = (over: Partial<Extract<UpdaterConfig, { enabled: true }>> = {}): UpdaterConfig => ({ enabled: true, channel: "latest", checkNow: false, ...over });

test("controller applies safe settings, feed, channel and schedules checks", () => {
  const h = harness();
  h.controller.start(on({ channel: "beta", feedUrl: "https://u.example/p" }));
  assert.equal(h.updater.allowDowngrade, false);
  assert.equal(h.updater.channel, "beta");
  assert.equal(h.updater.disableWebInstaller, true);
  assert.equal(h.updater.autoDownload, true);
  assert.deepEqual(h.updater.feed, { provider: "generic", url: "https://u.example/p" });
  assert.equal(h.timeouts.length, 1);
  assert.deepEqual(h.intervals, [4 * 3600_000]);
  const stable = harness();
  stable.controller.start(on());
  assert.equal(stable.updater.channelSets, 0);
  assert.equal(stable.updater.feed, undefined);
  assert.equal(stable.updater.allowDowngrade, false);
});

test("checkNow checks immediately", () => {
  const h = harness();
  h.controller.start(on({ checkNow: true }));
  assert.deepEqual(h.calls, ["check"]);
});

test("downloaded + now installs", async () => {
  const h = harness();
  h.setAnswer("now");
  h.controller.start(on());
  h.listeners["update-downloaded"]({ version: "2.0.0" });
  await tick();
  assert.deepEqual(h.calls, ["install"]);
});

test("later without enforcementHours does not install", async () => {
  const h = harness();
  h.controller.start(on());
  h.listeners["update-downloaded"]({});
  await tick();
  assert.deepEqual(h.calls, []);
  assert.equal(h.timeouts.length, 1); // only the first check
});

test("later with enforcementHours forces a restart at the deadline", async () => {
  const h = harness();
  h.setNow(1000);
  h.controller.start(on({ enforcementHours: 2 }));
  h.setNow(1000);
  h.listeners["update-downloaded"]({});
  await tick();
  const forced = h.timeouts[1];
  assert.equal(forced.ms, 2 * 3600_000);
  h.setNow(1000 + 2 * 3600_000);
  forced.fn();
  await tick();
  assert.deepEqual(h.calls, ["force", "install"]);
});

test("gate below forces immediately without asking", async () => {
  const h = harness();
  h.setAnswer("now");
  h.controller.start(on({ checkNow: true }));
  h.calls.length = 0;
  h.listeners["update-downloaded"]({});
  await tick();
  assert.deepEqual(h.calls, ["force", "install"]);
});

test("error event never installs or throws", () => {
  const h = harness();
  h.controller.start(on());
  h.listeners["error"](new Error("boom"));
  assert.deepEqual(h.calls, ["log:error: boom"]);
});

test("disabled config never touches the updater", () => {
  const h = harness();
  h.controller.start({ enabled: false, reason: "x" });
  assert.equal(h.updater.autoDownload, false);
  assert.equal(h.timeouts.length, 0);
  assert.deepEqual(h.listeners, {});
});

test("same version reported again: no second prompt, one timer", async () => {
  const h = harness();
  h.controller.start(on({ enforcementHours: 2 }));
  h.listeners["update-downloaded"]({ version: "2.0.0" });
  await tick();
  h.listeners["update-downloaded"]({ version: "2.0.0" });
  await tick();
  assert.equal(h.asks(), 1);
  assert.equal(h.timeouts.length, 2); // first check + one enforcement timer
});

test("newer version after Later keeps one timer and the original deadline", async () => {
  const h = harness();
  h.setNow(1000);
  h.controller.start(on({ enforcementHours: 2 }));
  h.listeners["update-downloaded"]({ version: "2.0.0" });
  await tick();
  h.setNow(5000);
  h.listeners["update-downloaded"]({ version: "2.1.0" });
  await tick();
  assert.equal(h.asks(), 1);
  assert.equal(h.timeouts.length, 2);
  assert.equal(h.timeouts[1].ms, 2 * 3600_000);
});

test("forced path plus timer installs exactly once", async () => {
  const h = harness();
  h.controller.start(on({ enforcementHours: 1 }));
  h.listeners["update-downloaded"]({ version: "2.0.0" });
  await tick();
  h.setNow(3600_000);
  h.timeouts[1].fn();
  await tick();
  h.listeners["update-downloaded"]({ version: "2.0.0" });
  h.listeners["update-downloaded"]({ version: "2.1.0" });
  await tick();
  assert.equal(h.calls.filter((c) => c === "install").length, 1);
  assert.equal(h.calls.filter((c) => c === "force").length, 1);
});

test("gate below with repeated events opens one forced dialog", async () => {
  const h = harness();
  h.controller.start(on({ checkNow: true }));
  h.calls.length = 0;
  h.listeners["update-downloaded"]({ version: "2.0.0" });
  h.listeners["update-downloaded"]({ version: "2.1.0" });
  await tick();
  assert.deepEqual(h.calls, ["force", "install"]);
});

test("720 h enforcement is re-armed in chunks and does not fire early", async () => {
  const h = harness();
  h.controller.start(on({ enforcementHours: 720 }));
  h.listeners["update-downloaded"]({ version: "2.0.0" });
  await tick();
  assert.equal(h.timeouts[1].ms, 24 * 3600_000);
  h.setNow(24 * 3600_000);
  h.timeouts[1].fn();
  await tick();
  assert.deepEqual(h.calls, []);
  assert.equal(h.timeouts.length, 3);
  h.setNow(720 * 3600_000);
  h.timeouts[2].fn();
  await tick();
  assert.deepEqual(h.calls, ["force", "install"]);
});

test("parseHealth validates types", () => {
  assert.deepEqual(parseHealth(null), {});
  assert.deepEqual(parseHealth({ updates: { enabled: "yes", channel: "stable" } }), {});
  assert.deepEqual(parseHealth({ updates: { enabled: true, channel: "nightly" } }), {});
  assert.deepEqual(parseHealth({ updates: { enabled: true, channel: "stable", feedUrl: 5 } }), {});
  const ok = parseHealth({ updates: { enabled: true, channel: "beta", feedUrl: "https://x/y", enforcementHours: 1.5 }, versionGate: { status: "below", current: "1.0.0" } });
  assert.deepEqual(ok, { summary: { enabled: true, channel: "beta", feedUrl: "https://x/y" }, gate: { status: "below", current: "1.0.0" } });
  assert.equal(parseHealth({ updates: { enabled: true, channel: "stable", enforcementHours: "8" } }).summary?.enforcementHours, undefined);
  assert.equal(parseHealth({ versionGate: { status: "weird" } }).gate, undefined);
});
