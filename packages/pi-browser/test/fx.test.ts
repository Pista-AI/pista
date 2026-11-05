import { test } from "node:test";
import assert from "node:assert/strict";
import { EUR_RATES, rateFor } from "../src/fx.ts";

test("rateFor crosses through the base and knows the seven currencies", () => {
  for (const c of ["SEK", "EUR", "USD", "GBP", "NOK", "DKK", "CHF"]) assert.ok(EUR_RATES[c]! > 0, c);
  assert.equal(rateFor("EUR", "EUR"), 1);
  assert.ok(Math.abs(rateFor("USD", "SEK")! - 10) < 0.01);
  assert.ok(Math.abs(rateFor("usd", "sek")! * rateFor("SEK", "USD")! - 1) < 1e-9);
});

test("rateFor is undefined for an unknown currency and honours a caller table", () => {
  assert.equal(rateFor("USD", "XXX"), undefined);
  assert.equal(rateFor("USD", "SEK", { USD: 1, SEK: 9 }), 9);
});
