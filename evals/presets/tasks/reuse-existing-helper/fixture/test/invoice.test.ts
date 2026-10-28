import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceTotal, spreadFee, TEAM_PLAN, yearlyCents } from "../src/index.ts";

test("a fee is spread over the lines and the total grows by exactly the fee", () => {
  const lines = [
    { description: "Licence", amountCents: 10000 },
    { description: "Support", amountCents: 5000 },
  ];
  const spread = spreadFee(lines, 100);
  assert.deepEqual(spread.map((l) => l.amountCents), [10067, 5033]);
  assert.equal(invoiceTotal(spread), invoiceTotal(lines) + 100);
});

test("plans bill twelve months a year", () => {
  assert.equal(yearlyCents(TEAM_PLAN), 598800);
});
