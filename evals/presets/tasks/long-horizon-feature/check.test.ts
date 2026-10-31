import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

/** A test file in test/ that mentions the module and contains at least one assertion call. */
function hasTest(mod: string): boolean {
  return readdirSync("test")
    .filter((f) => f.endsWith(".test.ts") && !f.endsWith("-modules.test.ts") && f !== "core.test.ts")
    .some((f) => {
      const text = readFileSync(`test/${f}`, "utf8");
      return text.includes(mod) && /\bassert(\.\w+)?\(/.test(text);
    });
}

test("1 inventory: reorderQuantity", async () => {
  const { reorderQuantity } = await import("./src/inventory/reorder.ts");
  assert.equal(reorderQuantity({ onHand: 20, reserved: 5, dailyDemand: 4 }, 5), 13); // 28 needed, 15 available
  assert.equal(reorderQuantity({ onHand: 20, reserved: 5, dailyDemand: 4 }, 5, 0), 5);
  assert.equal(reorderQuantity({ onHand: 3, reserved: 8, dailyDemand: 1.5 }, 2), 6); // reserved above on-hand: nothing available
  assert.equal(reorderQuantity({ onHand: 100, reserved: 0, dailyDemand: 1 }, 3), 0);
});

test("2 orders: bulkDiscountCents", async () => {
  const { bulkDiscountCents } = await import("./src/orders/bulk-discount.ts");
  const line = (qty: number, unitCents: number) => ({ sku: "x", qty, unitCents });
  assert.equal(bulkDiscountCents([]), 0);
  assert.equal(bulkDiscountCents([line(9, 1000)]), 0);
  assert.equal(bulkDiscountCents([line(10, 1999)]), 999); // 19990 * 5% = 999.5, rounded down
  assert.equal(bulkDiscountCents([line(49, 100)]), 245);
  assert.equal(bulkDiscountCents([line(50, 101)]), 505);
  assert.equal(bulkDiscountCents([line(100, 333)]), 4995);
  assert.equal(bulkDiscountCents([line(10, 100), line(50, 100), line(2, 100)]), 50 + 500);
});

test("3 billing: invoice numbers", async () => {
  const { formatInvoiceNumber, parseInvoiceNumber } = await import("./src/billing/invoice-number.ts");
  assert.equal(formatInvoiceNumber(2026, 42), "INV-2026-000042");
  assert.equal(formatInvoiceNumber(2031, 999999), "INV-2031-999999");
  for (const bad of [0, -1, 1.5, 1_000_000, Number.NaN]) assert.throws(() => formatInvoiceNumber(2026, bad), RangeError);
  assert.deepEqual(parseInvoiceNumber("INV-2026-000042"), { year: 2026, seq: 42 });
  for (const bad of ["", "INV-2026-42", "inv-2026-000042", "INV-2026-000000", "INV-2026-0000421", " INV-2026-000042"]) assert.equal(parseInvoiceNumber(bad), null, bad);
});

test("4 notifications: renderTemplate", async () => {
  const { renderTemplate } = await import("./src/notifications/render.ts");
  assert.equal(renderTemplate("Hi {{name}}!", { name: "Ada" }), "Hi Ada!");
  assert.equal(renderTemplate("{{ a }}-{{b}}-{{ a }}", { a: 1, b: true }), "1-true-1");
  assert.equal(renderTemplate("<p>{{ msg }}</p>", { msg: `<b>"x" & 'y'</b>` }), "<p>&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;</p>");
  assert.equal(renderTemplate("no variables", {}), "no variables");
  assert.throws(() => renderTemplate("Hi {{name}}", { other: 1 }), (e: Error) => e.message === "missing variable: name");
});

test("5 reports: salesByDay", async () => {
  const { salesByDay } = await import("./src/reports/sales-by-day.ts");
  const rows = salesByDay([
    { placedAt: "2026-03-05T10:00:00Z", totalCents: 100 },
    { placedAt: "2026-03-04T23:59:00Z", totalCents: 50 },
    { placedAt: "2026-03-04T01:00:00Z", totalCents: 25, status: "cancelled" },
    { placedAt: "2026-03-04T12:00:00Z", totalCents: 70, status: "paid" },
    { placedAt: "2026-03-05T00:00:00+02:00", totalCents: 10 }, // 2026-03-04 22:00 UTC
  ]);
  assert.deepEqual(rows, [{ day: "2026-03-04", orders: 3, totalCents: 130 }, { day: "2026-03-05", orders: 1, totalCents: 100 }]);
  assert.deepEqual(salesByDay([]), []);
});

for (const mod of ["inventory/reorder", "orders/bulk-discount", "billing/invoice-number", "notifications/render", "reports/sales-by-day"]) {
  test(`own test file with assertions: ${mod}`, () => assert.ok(hasTest(mod), `no test in test/ mentions ${mod} and asserts something`));
}
