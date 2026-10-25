import assert from "node:assert/strict";
import { test } from "node:test";
import { neutralizePaneDragRegions, PANE_NO_DRAG_CSS } from "../src/pane-drag.ts";

type Fake = Parameters<typeof neutralizePaneDragRegions>[0];

function makeFake(insertCSS: (css: string, options?: unknown) => Promise<string>) {
  const listeners = new Map<string, () => void>();
  const calls: Array<{ css: string; options?: unknown }> = [];
  const fake = {
    on(event: string, listener: () => void) {
      listeners.set(event, listener);
      return fake;
    },
    insertCSS(css: string, options?: unknown) {
      calls.push({ css, options });
      return insertCSS(css, options);
    },
  };
  return { fake: fake as unknown as Fake, listeners, calls };
}

test("injects the no-drag stylesheet as user-origin CSS on dom-ready", () => {
  const { fake, listeners, calls } = makeFake(async () => "key");
  neutralizePaneDragRegions(fake);
  const listener = listeners.get("dom-ready");
  assert.ok(listener, "dom-ready listener registered");
  assert.equal(calls.length, 0);
  listener();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].css, PANE_NO_DRAG_CSS);
  assert.deepEqual(calls[0].options, { cssOrigin: "user" });
  assert.ok(PANE_NO_DRAG_CSS.includes("-webkit-app-region: no-drag !important"));
  assert.ok(PANE_NO_DRAG_CSS.includes("app-region: no-drag !important"));
});

test("a rejected insertCSS is swallowed", async () => {
  const { fake, listeners } = makeFake(async () => {
    throw new Error("destroyed");
  });
  neutralizePaneDragRegions(fake);
  assert.doesNotThrow(() => listeners.get("dom-ready")!());
  await new Promise((resolve) => setImmediate(resolve));
});
