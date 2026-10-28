import assert from "node:assert/strict";
import { test } from "node:test";
import { addLine, checkout, emptyCart } from "../src/index.ts";
import { vatIncluded } from "../src/tax/vat.ts";

test("checkout adds the destination's shipping and applies discount codes", () => {
  const cart = addLine(emptyCart(), "pot-02");
  assert.equal(checkout(cart, "SE").totalCents, 64900 + 4900);
  assert.equal(checkout(cart, "DE", "SUMMER25").totalCents, 64900 - 16225 + 14900);
  assert.equal(checkout(emptyCart(), "SE").shippingCents, 0);
});

test("VAT is extracted from the gross amount", () => {
  assert.equal(vatIncluded(12500, "SE"), 2500);
});
