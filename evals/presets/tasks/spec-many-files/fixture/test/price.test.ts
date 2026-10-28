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

test("formatting", () => {
  assert.equal(formatPrice(price(1250)), "12.50");
});

test("json round trip", () => {
  assert.deepEqual(priceFromJson(priceToJson(price(777))), price(777));
});
