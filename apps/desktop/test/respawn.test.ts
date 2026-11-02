import assert from "node:assert/strict";
import { test } from "node:test";
import { nextRespawn, RESPAWN_MAX_FAILURES, RESPAWN_STABLE_MS } from "../src/respawn.ts";

test("backs off exponentially and gives up after the cap", () => {
  let state = { failures: 0 };
  const delays: Array<number | null> = [];
  for (let i = 0; i < RESPAWN_MAX_FAILURES + 1; i++) {
    const r = nextRespawn(state, 100);
    state = r.state;
    delays.push(r.delayMs);
  }
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, null]);
});

test("a stable run resets the failure count", () => {
  const r = nextRespawn({ failures: 4 }, RESPAWN_STABLE_MS);
  assert.deepEqual(r, { state: { failures: 1 }, delayMs: 500 });
});
