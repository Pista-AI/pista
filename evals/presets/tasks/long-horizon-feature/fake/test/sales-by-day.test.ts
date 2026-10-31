import assert from "node:assert/strict";
import { test } from "node:test";
import { salesByDay } from "../src/reports/sales-by-day.ts";

test("salesByDay", () => {
  const rows = salesByDay([
    { placedAt: "2026-03-05T10:00:00Z", totalCents: 100 },
    { placedAt: "2026-03-04T23:59:00Z", totalCents: 50 },
    { placedAt: "2026-03-04T01:00:00Z", totalCents: 25, status: "cancelled" },
  ]);
  assert.deepEqual(rows, [{ day: "2026-03-04", orders: 1, totalCents: 50 }, { day: "2026-03-05", orders: 1, totalCents: 100 }]);
});
