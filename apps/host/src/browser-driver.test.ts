import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpDriver, ChromeDriver, type BrowserDriver } from "@pista/pi-browser";
import { bringChromeToFront, createBrowserDriver, PaneBrowserDriver, resolveBrowserDriverConfig, resolveBrowserEngine } from "./browser-driver.ts";
import type { Hub } from "./hub.ts";

const found = () => ({ kind: "chrome" as const, path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const none = () => null;

test("showing Chrome is false while no Chrome driver exists", async () => {
  assert.equal(await bringChromeToFront(), false);
});

test("the env var pane selects the pane driver", () => {
  assert.deepEqual(resolveBrowserDriverConfig({ PISTA_BROWSER_DRIVER: "pane" }), { kind: "pane" });
});

test("engine resolution: env beats setting beats auto", () => {
  // The env var wins over any setting, even with a browser installed.
  assert.equal(resolveBrowserEngine({ PISTA_BROWSER_DRIVER: "pane" }, "chrome", found).config.kind, "pane");
  assert.equal(resolveBrowserEngine({ PISTA_BROWSER_DRIVER: "chrome" }, "embedded", none).config.kind, "chrome");
  // The setting beats auto.
  assert.equal(resolveBrowserEngine({}, "embedded", found).config.kind, "pane");
  assert.equal(resolveBrowserEngine({}, "chrome", found).config.kind, "chrome");
  // Auto: chrome when one is found, else pane.
  assert.equal(resolveBrowserEngine({}, "auto", found).config.kind, "chrome");
  assert.equal(resolveBrowserEngine({}, "auto", none).config.kind, "pane");
  assert.equal(resolveBrowserEngine({}, undefined, none).config.kind, "pane");
});

test("a policy-pinned engine ignores PISTA_BROWSER_DRIVER", () => {
  const r = resolveBrowserEngine({ PISTA_BROWSER_DRIVER: "pane" }, "chrome", found, true);
  assert.equal(r.config.kind, "chrome");
  assert.equal(resolveBrowserEngine({ PISTA_BROWSER_DRIVER: "bogus" }, "embedded", found, true).config.kind, "pane");
  assert.equal(resolveBrowserEngine({}, "auto", none).fallback, true);
});

test("engine resolution explains itself", () => {
  assert.equal(resolveBrowserEngine({}, "auto", none).reason, "auto: no Chrome found");
  assert.equal(resolveBrowserEngine({}, "auto", found).browserName, "Google Chrome");
  assert.match(resolveBrowserEngine({}, "chrome", none).reason, /no Chrome found/);
  assert.equal(resolveBrowserEngine({}, "chrome", none).config.kind, "pane");
  assert.match(resolveBrowserEngine({ PISTA_BROWSER_DRIVER: "pane" }, "auto", found).reason, /PISTA_BROWSER_DRIVER/);
  assert.deepEqual(resolveBrowserEngine({ PISTA_BROWSER_PATH: "/x/chrome" }, "auto", found).config, { kind: "chrome", browserPath: "/x/chrome" });
});

test("cdp with a url selects the CDP driver, shared across threads", () => {
  const config = resolveBrowserDriverConfig({ PISTA_BROWSER_DRIVER: "cdp", PI_BROWSER_CDP_URL: "http://127.0.0.1:9222" });
  assert.deepEqual(config, { kind: "cdp", url: "http://127.0.0.1:9222" });
  const deps = { hub: {} as Hub, ref: { threadId: "t" } };
  const a = createBrowserDriver(config, deps);
  assert.ok(a instanceof CdpDriver);
  assert.equal(createBrowserDriver(config, { ...deps, ref: { threadId: "u" } }), a);
});

test("pane config builds a per-thread pane driver", () => {
  const deps = { hub: {} as Hub, ref: { threadId: "t" } };
  const driver = createBrowserDriver({ kind: "pane" }, deps);
  assert.ok(driver instanceof PaneBrowserDriver);
  assert.notEqual(createBrowserDriver({ kind: "pane" }, deps), driver);
});

test("cdp without a url is a clear error", () => {
  assert.throws(() => resolveBrowserDriverConfig({ PISTA_BROWSER_DRIVER: "cdp" }), /PI_BROWSER_CDP_URL/);
  assert.throws(() => resolveBrowserDriverConfig({ PISTA_BROWSER_DRIVER: "cdp", PI_BROWSER_CDP_URL: "  " }), /PI_BROWSER_CDP_URL/);
});

test("an unknown driver is a clear error", () => {
  assert.throws(() => resolveBrowserDriverConfig({ PISTA_BROWSER_DRIVER: "headless" }), /Unknown PISTA_BROWSER_DRIVER "headless"/);
});

test("chrome selects one shared chrome driver with no login tools", () => {
  const config = resolveBrowserDriverConfig({ PISTA_BROWSER_DRIVER: "chrome", PISTA_BROWSER_PATH: " /opt/chrome " });
  assert.deepEqual(config, { kind: "chrome", browserPath: "/opt/chrome" });
  assert.deepEqual(resolveBrowserDriverConfig({ PISTA_BROWSER_DRIVER: "chrome" }), { kind: "chrome" });
  const deps = { hub: { onViewersChanged() {}, viewerCount: 1 } as unknown as Hub, ref: { threadId: "t" }, pistaHome: "/tmp/none" };
  const a = createBrowserDriver(config, deps);
  assert.ok(a instanceof ChromeDriver);
  assert.equal((a as any).feed.count, 1, "a window that subscribed before the driver existed gets frames");
  assert.equal(createBrowserDriver(config, { ...deps, ref: { threadId: "u" } }), a);
  assert.equal((a as BrowserDriver).loginList, undefined);
  assert.equal((a as BrowserDriver).loginFill, undefined);
});
