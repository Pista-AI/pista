import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpDriver } from "@pista/pi-browser";
import { createBrowserDriver, PaneBrowserDriver, resolveBrowserDriverConfig } from "./browser-driver.ts";
import type { Hub } from "./hub.ts";

test("defaults to the pane driver", () => {
  assert.deepEqual(resolveBrowserDriverConfig({}), { kind: "pane" });
  assert.deepEqual(resolveBrowserDriverConfig({ PISTA_BROWSER_DRIVER: "pane" }), { kind: "pane" });
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
