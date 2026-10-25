import assert from "node:assert/strict";
import { test } from "node:test";
import { POPUP_EXTRA_MS, runPageAction, settle } from "../src/actions.ts";
import type { BrowserDriver } from "../src/driver.ts";
import { scripts } from "../src/page-scripts.ts";

/** A driver whose page reports `loading` between two moments after the "click", and whose animation frames resolve at once. */
function fakeDriver(options: { loadingFrom?: number; loadingUntil?: number; frames?: "now" | "never"; probe?: () => string } = {}) {
  const clicked = Date.now();
  const states: number[] = [];
  const driver = {
    state: async () => {
      const t = Date.now() - clicked;
      states.push(t);
      const loading = options.loadingFrom !== undefined && t >= options.loadingFrom && t < (options.loadingUntil ?? Infinity);
      return { url: "http://fixture/", title: "t", loading };
    },
    evaluate: async (script: string) => {
      if (script === scripts.frames()) return options.frames === "never" ? new Promise(() => {}) : true;
      if (script === scripts.probe()) return options.probe?.() ?? "same";
      return undefined;
    },
  } as unknown as BrowserDriver;
  return { driver, elapsed: () => Date.now() - clicked, states };
}

test("settle returns quickly when the page isn't loading", async () => {
  const { driver, elapsed } = fakeDriver();
  await settle(driver);
  assert.ok(elapsed() < 400, `took ${elapsed()} ms`);
});

test("settle waits for a navigation that registers shortly after the click", async () => {
  const { driver, elapsed } = fakeDriver({ loadingFrom: 60, loadingUntil: 400 });
  await settle(driver);
  assert.ok(elapsed() >= 380, `returned after ${elapsed()} ms, before the load ended`);
  assert.ok(elapsed() < 1000, `took ${elapsed()} ms`);
});

test("settle doesn't hang on frames that never come (throttled tab)", async () => {
  const { driver, elapsed } = fakeDriver({ frames: "never" });
  await settle(driver);
  assert.ok(elapsed() < 600, `took ${elapsed()} ms`);
});

test("scrolling doesn't look for a late navigation", async () => {
  const { driver, elapsed } = fakeDriver({ loadingFrom: 60, loadingUntil: 400 });
  await settle(driver, { noNavigation: true });
  assert.ok(elapsed() < 150, `took ${elapsed()} ms`);
});

test("a popup list gets extra time, and settle stops as soon as the page changed", async () => {
  const slow = fakeDriver({ probe: () => "same" });
  await settle(slow.driver, { popupBaseline: "same" });
  assert.ok(slow.elapsed() >= POPUP_EXTRA_MS, `took ${slow.elapsed()} ms`);
  const fast = fakeDriver({ probe: () => "changed" });
  await settle(fast.driver, { popupBaseline: "same" });
  assert.ok(fast.elapsed() < 100 + POPUP_EXTRA_MS - 40 && fast.elapsed() < slow.elapsed() - 60, `took ${fast.elapsed()} ms, against ${slow.elapsed()} ms when nothing changes`);
});

test("typing into a search box waits for a popup that never opens, even though focus moved into the field", async () => {
  const clicked = Date.now();
  let focused = false;
  const driver = {
    state: async () => ({ url: "http://fixture/", title: "t", loading: false }),
    input: async (e: { type: string }) => {
      if (e.type === "click") focused = true;
      return true;
    },
    evaluate: async (script: string) => {
      if (script === scripts.frames()) return true;
      // The fingerprint ignores focus: it is the same before and after the click.
      if (script === scripts.probe()) return "same";
      if (script === scripts.focusReady("e1")) return focused;
      if (script === scripts.selectActive()) return { editable: true, label: "q" };
      if (script === scripts.prepare("e1", "type", undefined)) return { label: "input", x: 5, y: 5, role: "searchbox" };
      if (script === scripts.snapshot(150) || script === scripts.snapshot(150, false, true)) return { lines: [], count: 0, omitted: 0, scroll: { y: 0, height: 10, viewport: 10 }, elements: [] };
      return undefined;
    },
  } as unknown as BrowserDriver;
  await runPageAction(driver, { action: "type", target: "e1", text: "cph" });
  assert.ok(Date.now() - clicked >= POPUP_EXTRA_MS, `took ${Date.now() - clicked} ms`);
});
