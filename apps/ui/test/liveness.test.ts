import assert from "node:assert/strict";
import { test } from "node:test";
import { watchLiveness } from "../src/lib/liveness.ts";

test("silence past the stale limit fires onStale once and stops pinging", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  let pings = 0;
  let stale = 0;
  watchLiveness({ ping: () => pings++, onStale: () => stale++, pingMs: 100, staleMs: 250 });
  t.mock.timers.tick(200);
  assert.equal(pings, 2);
  assert.equal(stale, 0);
  t.mock.timers.tick(100);
  assert.equal(stale, 1);
  t.mock.timers.tick(1000);
  assert.equal(stale, 1);
  assert.equal(pings, 2);
});

test("incoming messages keep the socket alive; stop cancels the watch", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  let stale = 0;
  const watch = watchLiveness({ ping: () => {}, onStale: () => stale++, pingMs: 100, staleMs: 250 });
  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(100);
    watch.touch();
  }
  assert.equal(stale, 0);
  watch.stop();
  t.mock.timers.tick(1000);
  assert.equal(stale, 0);
});
