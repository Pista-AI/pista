import assert from "node:assert/strict";
import { test } from "node:test";
import { formatOrderNumber, parseOrderNumber } from "../src/billing/order-number.ts";

test("order numbers", () => {
  assert.equal(formatOrderNumber(2026, 42), "ORD-2026-00042");
  assert.equal(formatOrderNumber(2031, 99999), "ORD-2031-99999");
  for (const bad of [0, -1, 1.5, 100000, Number.NaN]) assert.throws(() => formatOrderNumber(2026, bad), RangeError);
  assert.deepEqual(parseOrderNumber("ORD-2026-00042"), { year: 2026, seq: 42 });
  for (const bad of ["", "ORD-2026-42", "ORD-2026-000042", "ord-2026-00042", "ORD-2026-00000", " ORD-2026-00042", "ORD-2026-00042 ", "ORD-26-00042"]) assert.equal(parseOrderNumber(bad), null, bad);
});
