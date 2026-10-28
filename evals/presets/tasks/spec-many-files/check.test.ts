import assert from "node:assert/strict";
import { test } from "node:test";
import {
  add, addLine, cartTotal, checkout, emptyCart, findProduct, formatPrice, lineTotal, multiply, negate, percentOff,
  price, priceFromJson, priceToJson, receipt, refundLine, sum, totalRevenue, zero,
} from "./src/index.ts";

const MISMATCH = { message: "Currency mismatch: EUR vs SEK" };

test("Price has a currency, EUR by default", () => {
  assert.deepEqual(price(100), { amountCents: 100, currency: "EUR" });
  assert.deepEqual(price(100, "SEK"), { amountCents: 100, currency: "SEK" });
  assert.deepEqual(zero(), { amountCents: 0, currency: "EUR" });
  assert.deepEqual(zero("SEK"), { amountCents: 0, currency: "SEK" });
});

test("add keeps the currency and rejects a mix with the exact message", () => {
  assert.deepEqual(add(price(1, "SEK"), price(2, "SEK")), price(3, "SEK"));
  assert.throws(() => add(price(1), price(1, "SEK")), MISMATCH);
  assert.throws(() => add(price(1, "SEK"), price(1, "NOK")), { message: "Currency mismatch: SEK vs NOK" });
  assert.throws(() => add(price(1), price(1, "SEK")), Error);
});

test("sum", () => {
  assert.deepEqual(sum([]), price(0));
  assert.deepEqual(sum([price(1, "SEK"), price(2, "SEK"), price(3, "SEK")]), price(6, "SEK"));
  assert.throws(() => sum([price(1), price(2, "SEK")]), MISMATCH);
});

test("multiply, negate and percentOff keep the currency and the old rounding", () => {
  assert.deepEqual(multiply(price(333, "SEK"), 3), price(999, "SEK"));
  assert.deepEqual(multiply(price(105, "SEK"), 0.5), price(53, "SEK"));
  assert.deepEqual(negate(price(40, "SEK")), price(-40, "SEK"));
  assert.deepEqual(percentOff(price(4490, "SEK"), 10), price(449, "SEK"));
  assert.deepEqual(percentOff(price(4490), 10), price(449));
});

test("catalog has the SEK product and the old ones are EUR", () => {
  assert.deepEqual(findProduct("kanna"), { id: "kanna", name: "Kanna", price: price(14900, "SEK") });
  assert.deepEqual(findProduct("mug").price, price(1250));
  assert.throws(() => findProduct("nope"), /unknown product nope/);
});

test("carts, checkout and refunds carry the currency", () => {
  assert.deepEqual(cartTotal(emptyCart()), price(0));
  const sek = addLine(emptyCart(), "kanna", 2);
  assert.deepEqual(lineTotal(sek.lines[0]!), price(29800, "SEK"));
  assert.deepEqual(cartTotal(sek), price(29800, "SEK"));
  const t = checkout(sek, 10);
  assert.deepEqual(t.discount, price(2980, "SEK"));
  assert.deepEqual(t.total, price(26820, "SEK"));
  assert.deepEqual(refundLine({ productId: "kanna", qty: 1 }), price(-14900, "SEK"));
  assert.deepEqual(refundLine({ productId: "lamp", qty: 1 }), price(-4900));
  assert.deepEqual(cartTotal(addLine(addLine(emptyCart(), "mug", 2), "book")), price(4490));
  assert.throws(() => cartTotal(addLine(addLine(emptyCart(), "mug"), "kanna")), MISMATCH);
});

test("formatPrice and receipts print <amount> <currency>", () => {
  assert.equal(formatPrice(price(1250, "SEK")), "12.50 SEK");
  assert.equal(formatPrice(price(-5)), "-0.05 EUR");
  assert.equal(receipt(addLine(addLine(emptyCart(), "mug", 2), "book")), "Mug x2  25.00 EUR\nBook x1  19.90 EUR\nTotal  44.90 EUR");
  assert.equal(receipt(addLine(emptyCart(), "kanna")), "Kanna x1  149.00 SEK\nTotal  149.00 SEK");
  assert.equal(receipt(addLine(emptyCart(), "kanna"), 50), "Kanna x1  149.00 SEK\nTotal  74.50 SEK");
});

test("JSON includes the currency and old JSON is read as EUR", () => {
  assert.deepEqual(priceToJson(price(777, "SEK")), { amountCents: 777, currency: "SEK" });
  assert.deepEqual(priceToJson(price(5)), { amountCents: 5, currency: "EUR" });
  assert.deepEqual(priceFromJson({ amountCents: 5 }), price(5));
  assert.deepEqual(priceFromJson({ amountCents: 5, currency: "NOK" }), price(5, "NOK"));
});

test("revenue adds orders of one currency and rejects a mix", () => {
  assert.deepEqual(totalRevenue([{ id: "a", total: price(10, "SEK") }, { id: "b", total: price(5, "SEK") }]), price(15, "SEK"));
  assert.deepEqual(totalRevenue([]), price(0));
  assert.throws(() => totalRevenue([{ id: "a", total: price(10) }, { id: "b", total: price(5, "SEK") }]), MISMATCH);
});
