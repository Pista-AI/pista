import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInvoiceNumber, parseInvoiceNumber } from "../src/billing/invoice-number.ts";

test("invoice numbers", () => {
  assert.equal(formatInvoiceNumber(2026, 42), "INV-2026-000042");
  assert.throws(() => formatInvoiceNumber(2026, 0), RangeError);
  assert.deepEqual(parseInvoiceNumber("INV-2026-000042"), { year: 2026, seq: 42 });
  assert.equal(parseInvoiceNumber("nope"), null);
});
