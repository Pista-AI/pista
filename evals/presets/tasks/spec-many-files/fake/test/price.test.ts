import assert from "node:assert/strict";
import { test } from "node:test";
import { add, formatPrice, multiply, negate, price, priceFromJson, priceToJson, sum, zero } from "../src/index.ts";

test("arithmetic on prices", () => {
  assert.equal(add(price(100), price(250)).amountCents, 350);
  assert.equal(multiply(price(333), 3).amountCents, 999);
  assert.equal(negate(price(40)).amountCents, -40);
  assert.equal(sum([]).amountCents, 0);
  assert.equal(zero().amountCents, 0);
});

test("prices default to EUR and keep their currency through arithmetic", () => {
  assert.equal(price(100).currency, "EUR");
  assert.equal(zero("SEK").currency, "SEK");
  assert.equal(add(price(1, "SEK"), price(2, "SEK")).currency, "SEK");
  assert.equal(multiply(price(5, "SEK"), 2).currency, "SEK");
  assert.equal(negate(price(5, "SEK")).currency, "SEK");
  assert.equal(sum([price(1, "SEK"), price(2, "SEK")]).currency, "SEK");
  assert.equal(sum([]).currency, "EUR");
});

test("mixing currencies is rejected", () => {
  assert.throws(() => add(price(1), price(1, "SEK")), { message: "Currency mismatch: EUR vs SEK" });
});

test("formatting", () => {
  assert.equal(formatPrice(price(1250)), "12.50 EUR");
  assert.equal(formatPrice(price(1250, "SEK")), "12.50 SEK");
});

test("json round trip, and old JSON without a currency is EUR", () => {
  assert.deepEqual(priceFromJson(priceToJson(price(777, "SEK"))), price(777, "SEK"));
  assert.deepEqual(priceFromJson({ amountCents: 5 }), price(5));
});
