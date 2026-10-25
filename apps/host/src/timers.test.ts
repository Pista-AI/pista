import assert from "node:assert/strict";
import { test } from "node:test";
import { clampTimerMs, MAX_TIMER_MS } from "./timers.ts";

test("clampTimerMs caps delays at the Node timer limit", () => {
  assert.equal(MAX_TIMER_MS, 2147483647);
  assert.equal(clampTimerMs(1000), 1000);
  assert.equal(clampTimerMs(10080 * 60_000), 10080 * 60_000);
  assert.equal(clampTimerMs(36000 * 60_000), MAX_TIMER_MS);
  assert.equal(clampTimerMs(Infinity), MAX_TIMER_MS);
});
