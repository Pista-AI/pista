import assert from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "../src/index.ts";

test("parts add up to the total", () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(allocate(9999, [3, 5, 7]).reduce((a, b) => a + b, 0), 9999);
});

test("larger remainders win the extra cents", () => {
  assert.deepEqual(allocate(10, [1, 2]), [3, 7]);
});

test("rejects empty or non-positive weights", () => {
  assert.throws(() => allocate(100, []), RangeError);
  assert.throws(() => allocate(100, [1, 0]), RangeError);
});
