import assert from "node:assert/strict";
import { test } from "node:test";
import { capModel, usageTotals } from "./models.ts";

test("usageTotals bills input, output and both cache counts, and reports the cache-read share", () => {
  assert.deepEqual(usageTotals({ input: 10, output: 5, cacheRead: 80, cacheWrite: 3 }), { billed: 98, output: 5, cacheRead: 80 });
});

test("usageTotals treats missing counts as zero", () => {
  assert.deepEqual(usageTotals({}), { billed: 0, output: 0, cacheRead: 0 });
  assert.deepEqual(usageTotals({ input: 7 }), { billed: 7, output: 0, cacheRead: 0 });
});

test("capModel clamps maxTokens without mutating, and returns the same object when unchanged", () => {
  const model = { id: "m", maxTokens: 384000 };
  assert.equal(capModel(model, {}), model);
  assert.equal(capModel(model, { maxOutputTokens: 500000 }), model);
  assert.equal(capModel(model, { maxOutputTokens: 384000 }), model);
  const capped = capModel(model, { maxOutputTokens: 65536 });
  assert.equal(capped.maxTokens, 65536);
  assert.equal(capped.id, "m");
  assert.notEqual(capped, model);
  assert.equal(model.maxTokens, 384000);
});
