import assert from "node:assert/strict";
import { test } from "node:test";
import { available, isLow } from "../src/inventory/stock.ts";
import { orderSubtotal } from "../src/orders/lines.ts";
import { padNumber } from "../src/billing/numbers.ts";
import { escapeHtml } from "../src/notifications/escape.ts";
import { groupBy } from "../src/reports/aggregate.ts";
import { dayOf } from "../src/reports/dates.ts";

test("core helpers", () => {
  assert.equal(available({ onHand: 3, reserved: 5 }), 0);
  assert.equal(isLow({ onHand: 10, reserved: 6 }), true);
  assert.equal(orderSubtotal([{ sku: "a", qty: 2, unitCents: 150 }]), 300);
  assert.equal(padNumber(42, 6), "000042");
  assert.equal(escapeHtml("<b>&"), "&lt;b&gt;&amp;");
  assert.equal(groupBy([1, 2, 3], (n) => (n % 2 ? "odd" : "even")).get("odd")!.length, 2);
  assert.equal(dayOf("2026-03-04T23:30:00Z"), "2026-03-04");
});
