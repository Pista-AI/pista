import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_FRAME_INTERVAL_MS, ScreencastFeed, type ScreencastFrame } from "../src/chrome/screencast.ts";
import type { CdpEvent, CdpTransport } from "../src/chrome/pipe.ts";
import { ChromeDriver } from "../src/drivers/chrome.ts";

const frame: ScreencastFrame = { data: "AAAA", width: 100, height: 50, url: "u", title: "t" };

test("throttles to about 8 fps by dropping early frames", () => {
  let t = 0;
  const feed = new ScreencastFeed({ start() {}, stop() {} }, () => t);
  const got: number[] = [];
  feed.subscribe(() => got.push(t));
  for (t = 0; t < 1000; t += 16) feed.push(frame); // 60 fps in
  assert.ok(got.length <= 9 && got.length >= 7, String(got.length));
  assert.ok(got.every((v, i) => i === 0 || v - got[i - 1] >= MIN_FRAME_INTERVAL_MS));
});

test("starts with the first subscriber and stops with the last", () => {
  const log: string[] = [];
  const feed = new ScreencastFeed({ start: () => log.push("start"), stop: () => log.push("stop") });
  const a = feed.subscribe(() => {});
  const b = feed.subscribe(() => {});
  a();
  a(); // a second unsubscribe does nothing
  assert.deepEqual(log, ["start"]);
  b();
  assert.deepEqual(log, ["start", "stop"]);
  assert.equal(feed.push(frame), false);
});

test("driver acks every frame, delivers at most the throttled ones, and runs the screencast only while subscribed", async () => {
  const calls: { method: string; params: any }[] = [];
  const handlers: ((e: CdpEvent) => void)[] = [];
  const transport: CdpTransport = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === "Target.createTarget") return { targetId: "T1" };
      if (method === "Target.attachToTarget") return { sessionId: "S1" };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "F1" } } };
      if (method === "Target.getTargetInfo") return { targetInfo: { url: "https://x/", title: "X" } };
      return {};
    },
    onEvent: (h) => void handlers.push(h),
    onClose() {},
    close() {},
  };
  const driver = new ChromeDriver({ pistaHome: "/nowhere" }, { find: () => ({ kind: "chrome", path: "/c" }), launch: (async () => ({ transport, process: {}, close: async () => {} })) as any });
  const methods = () => calls.map((c) => c.method);
  const off = driver.onFrame(() => {});
  assert.equal(methods().length, 0, "subscribing does not launch the browser");
  await driver.state().catch(() => {}); // connects; the screencast starts because someone listens
  await new Promise((r) => setImmediate(r));
  assert.ok(methods().includes("Page.startScreencast"));
  assert.deepEqual(calls.find((c) => c.method === "Page.startScreencast")!.params, { format: "jpeg", quality: 60, maxWidth: 1280, everyNthFrame: 1 });
  const got: ScreencastFrame[] = [];
  const off2 = driver.onFrame((f) => got.push(f));
  off();
  assert.ok(!methods().includes("Page.stopScreencast"), "still one listener");
  for (let i = 0; i < 5; i++) handlers.forEach((h) => h({ method: "Page.screencastFrame", sessionId: "S1", params: { data: "D", sessionId: i + 1, metadata: { deviceWidth: 800, deviceHeight: 600 } } }));
  await new Promise((r) => setImmediate(r));
  const acks = calls.filter((c) => c.method === "Page.screencastFrameAck").map((c) => c.params.sessionId);
  assert.deepEqual(acks, [1, 2, 3, 4, 5]);
  assert.equal(got.length, 1);
  assert.equal(got[0].width, 800);
  off2();
  await new Promise((r) => setImmediate(r));
  assert.ok(methods().includes("Page.stopScreencast"));
});

function windowTest(state: string) {
  const calls: { method: string; params: any }[] = [];
  const transport: CdpTransport = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === "Target.createTarget") return { targetId: "T1" };
      if (method === "Target.attachToTarget") return { sessionId: "S1" };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "F1" } } };
      if (method === "Browser.getWindowForTarget") return { windowId: 7 };
      if (method === "Browser.getWindowBounds") return { bounds: { windowState: state } };
      return {};
    },
    onEvent() {},
    onClose() {},
    close() {},
  };
  const driver = new ChromeDriver({ pistaHome: "/nowhere" }, { find: () => ({ kind: "chrome", path: "/c" }), launch: (async () => ({ transport, process: {}, close: async () => {} })) as any });
  return { driver, calls };
}

test("bringToFront raises the page and restores a minimized window", async () => {
  const { driver, calls } = windowTest("minimized");
  await driver.bringToFront();
  assert.ok(calls.some((c) => c.method === "Page.bringToFront"));
  assert.deepEqual(calls.find((c) => c.method === "Browser.setWindowBounds")!.params, { windowId: 7, bounds: { windowState: "normal" } });
});

test("bringToFront leaves fullscreen, maximized and normal windows alone", async () => {
  for (const state of ["fullscreen", "maximized", "normal"]) {
    const { driver, calls } = windowTest(state);
    await driver.bringToFront();
    assert.ok(calls.some((c) => c.method === "Page.bringToFront"), state);
    assert.ok(!calls.some((c) => c.method === "Browser.setWindowBounds"), state);
  }
});
