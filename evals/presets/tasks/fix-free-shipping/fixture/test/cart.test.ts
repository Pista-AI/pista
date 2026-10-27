import assert from "node:assert/strict";
import { test } from "node:test";
import { addLine, emptyCart, removeLine } from "../src/index.ts";

test("adding the same product twice merges the line", () => {
  const cart = addLine(addLine(emptyCart(), "mug-01"), "mug-01", 2);
  assert.deepEqual(cart.lines, [{ productId: "mug-01", qty: 3 }]);
});

test("removing a line", () => {
  const cart = removeLine(addLine(addLine(emptyCart(), "mug-01"), "lamp-04"), "mug-01");
  assert.deepEqual(cart.lines, [{ productId: "lamp-04", qty: 1 }]);
});

test("unknown products are rejected", () => {
  assert.throws(() => addLine(emptyCart(), "nope"), /unknown product/);
});
