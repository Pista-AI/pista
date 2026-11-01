import assert from "node:assert/strict";
import { test } from "node:test";
import { harnessConfigOf, harnessIdOf } from "./select.ts";

test("harnessIdOf: harness wins, legacy sliced mode maps to sliced, else solo", () => {
  assert.equal(harnessIdOf({}), "solo");
  assert.equal(harnessIdOf({ orchestratorMode: "sliced" }), "sliced");
  assert.equal(harnessIdOf({ orchestratorMode: "delegate" }), "solo");
  assert.equal(harnessIdOf({ harness: "sliced" }), "sliced");
  assert.equal(harnessIdOf({ harness: "solo", orchestratorMode: "sliced" }), "solo");
  assert.equal(harnessIdOf({ harness: "", orchestratorMode: "sliced" }), "sliced");
  assert.equal(harnessIdOf({ harness: "other" }), "other");
});

test("harnessConfigOf: harnessConfig wins, sliced falls back to the legacy key", () => {
  assert.equal(harnessConfigOf({}, "sliced"), undefined);
  assert.deepEqual(harnessConfigOf({ sliced: { minSlices: 2 } }, "sliced"), { minSlices: 2 });
  assert.deepEqual(harnessConfigOf({ sliced: { minSlices: 2 }, harnessConfig: { sliced: { minSlices: 4 } } }, "sliced"), { minSlices: 4 });
  assert.equal(harnessConfigOf({ sliced: { minSlices: 2 } }, "other"), undefined);
  assert.deepEqual(harnessConfigOf({ harnessConfig: { other: { a: 1 } } }, "other"), { a: 1 });
});
