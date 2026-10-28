import assert from "node:assert/strict";
import { test } from "node:test";
import { refundCents } from "../src/payments/refunds.ts";
import { settleOn } from "../src/index.ts";

test("payments settle on the next bank day", () => {
  assert.equal(settleOn(new Date("2026-03-04T10:00:00Z")).toISOString(), "2026-03-05T00:00:00.000Z");
  assert.equal(settleOn(new Date("2026-03-06T10:00:00Z")).toISOString(), "2026-03-09T00:00:00.000Z");
});

test("bank holidays are skipped", () => {
  assert.equal(settleOn(new Date("2026-04-02T10:00:00Z")).toISOString(), "2026-04-07T00:00:00.000Z");
});

test("refunds return the whole amount", () => {
  assert.equal(refundCents("card", 10000), 10000);
});
