import assert from "node:assert/strict";
import { test } from "node:test";
import { addLine, cartTotal, checkout, emptyCart, receipt, refundLine, totalRevenue, price } from "../src/index.ts";

const cart = addLine(addLine(emptyCart(), "mug", 2), "book");

test("cart totals", () => {
  assert.equal(cartTotal(cart).amountCents, 2 * 1250 + 1990);
});

test("checkout applies a percentage discount", () => {
  const t = checkout(cart, 10);
  assert.equal(t.discount.amountCents, 449);
  assert.equal(t.total.amountCents, 4490 - 449);
});

test("receipt lists lines and total", () => {
  assert.equal(receipt(cart), "Mug x2  25.00\nBook x1  19.90\nTotal  44.90");
});

test("refunds are negative", () => {
  assert.equal(refundLine({ productId: "lamp", qty: 1 }).amountCents, -4900);
});

test("revenue adds up paid orders", () => {
  assert.equal(totalRevenue([{ id: "o1", total: price(1000) }, { id: "o2", total: price(550) }]).amountCents, 1550);
});
