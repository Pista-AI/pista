import assert from "node:assert/strict";
import { test } from "node:test";
import { addLine, checkout, emptyCart, placeOrder, receipt } from "../src/index.ts";

test("large domestic order ships free", () => {
  const t = checkout(addLine(emptyCart(), "tent-05"), "SE");
  assert.equal(t.subtotalCents, 189000);
  assert.equal(t.shippingCents, 0);
  assert.equal(t.totalCents, 189000);
  assert.equal(t.vatCents, 37800);
});

test("discount codes are case-insensitive", () => {
  const t = checkout(addLine(emptyCart(), "tent-05"), "SE", "welcome10");
  assert.equal(t.discountCents, 18900);
  assert.equal(t.totalCents, 170100);
});

test("orders get their own id and the customer's country", () => {
  const order = placeOrder("c-2", addLine(emptyCart(), "pot-02"));
  assert.match(order.id, /^o-\d+$/);
  assert.equal(order.customerId, "c-2");
  assert.equal(order.totals.vatCents, 12980);
});

test("receipt", () => {
  const cart = addLine(emptyCart(), "tent-05");
  assert.match(receipt(cart, checkout(cart, "SE")), /Shipping free/);
});
