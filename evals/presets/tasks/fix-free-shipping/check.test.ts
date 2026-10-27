import assert from "node:assert/strict";
import { test } from "node:test";
import { addLine, checkout, emptyCart } from "./src/index.ts";

test("small orders pay the zone rate", () => {
  const mug = addLine(emptyCart(), "mug-01");
  assert.equal(checkout(mug, "SE").shippingCents, 4900);
  assert.equal(checkout(mug, "NO").shippingCents, 9900);
  assert.equal(checkout(mug, "DE").shippingCents, 14900);
  assert.equal(checkout(mug, "SE").totalCents, 12900 + 4900);
});

test("discounted orders below the threshold pay the destination's rate", () => {
  assert.equal(checkout(addLine(emptyCart(), "pot-02"), "DE", "SUMMER25").shippingCents, 14900);
});

test("the threshold is 500 SEK after discounts", () => {
  assert.equal(checkout(addLine(addLine(emptyCart(), "lamp-04"), "mug-01"), "SE").shippingCents, 4900); // 478 SEK
  assert.equal(checkout(addLine(addLine(emptyCart(), "lamp-04"), "book-03"), "SE").shippingCents, 0); // 548 SEK
  const pot = addLine(emptyCart(), "pot-02"); // 649 SEK
  assert.equal(checkout(pot, "NO").shippingCents, 0);
  assert.equal(checkout(pot, "SE", "WELCOME10").shippingCents, 0); // 584.10 SEK
  const t = checkout(pot, "SE", "SUMMER25"); // 486.75 SEK
  assert.equal(t.shippingCents, 4900);
  assert.equal(t.totalCents, 64900 - 16225 + 4900);
});

test("empty carts ship nothing", () => {
  assert.equal(checkout(emptyCart(), "SE").shippingCents, 0);
});
