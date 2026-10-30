import assert from "node:assert/strict";
import { test } from "node:test";
import { reorderQuantity } from "../src/inventory/reorder.ts";

test("reorderQuantity", () => {
  assert.equal(reorderQuantity({ onHand: 20, reserved: 5, dailyDemand: 4 }, 5), 13);
  assert.equal(reorderQuantity({ onHand: 100, reserved: 0, dailyDemand: 1 }, 3), 0);
});
