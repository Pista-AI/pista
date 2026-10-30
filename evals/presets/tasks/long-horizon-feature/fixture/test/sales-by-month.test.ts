import assert from "node:assert/strict";
import { test } from "node:test";
import { salesByMonth } from "../src/reports/sales-by-month.ts";

test("sales by month", () => {
  const rows = salesByMonth([
    { placedAt: "2026-04-01T00:00:00Z", totalCents: 100 },
    { placedAt: "2026-03-31T23:59:00Z", totalCents: 40 },
    { placedAt: "2026-03-10T12:00:00Z", totalCents: 60, status: "paid" },
    { placedAt: "2026-03-11T12:00:00Z", totalCents: 999, status: "cancelled" },
  ]);
  assert.deepEqual(rows, [{ month: "2026-03", orders: 2, totalCents: 100 }, { month: "2026-04", orders: 1, totalCents: 100 }]);
  assert.deepEqual(salesByMonth([]), []);
});
