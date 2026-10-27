import assert from "node:assert/strict";
import { test } from "node:test";
import { chunk, last } from "./list.ts";

test("chunk", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.throws(() => chunk([1], 0), RangeError);
  assert.throws(() => chunk([1], 1.5), RangeError);
  assert.equal(last([1, 2]), 2);
});
