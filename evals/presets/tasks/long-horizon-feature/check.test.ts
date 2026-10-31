import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Every assertion below follows from a sentence of task.md or from a convention visible in the fixture; the source is
// noted next to it. Conventions: src/billing/order-number.ts (strict parser: exact digit widths, upper-case prefix, no
// surrounding whitespace, sequence 0 rejected, null otherwise) and src/reports/sales-by-month.ts (`orders` is a count).


/** A test file in test/ that mentions the module and contains at least one assertion call. */
function hasTest(mod: string): boolean {
  return readdirSync("test")
    .filter((f) => f.endsWith(".test.ts") && !f.endsWith("-modules.test.ts") && f !== "core.test.ts")
    .some((f) => {
      const text = readFileSync(`test/${f}`, "utf8");
      return text.includes(mod) && /\bassert(\.\w+)?\(/.test(text);
    });
}

// Task item 1: demand = dailyDemand * (leadDays + safetyDays) rounded up, minus available(stock) (src/inventory/stock.ts, never negative), floored at 0.
test("1 inventory: reorderQuantity", async () => {
  const { reorderQuantity } = await import("./src/inventory/reorder.ts");
  assert.equal(reorderQuantity({ onHand: 20, reserved: 5, dailyDemand: 4 }, 5), 13); // 28 needed, 15 available
  assert.equal(reorderQuantity({ onHand: 20, reserved: 5, dailyDemand: 4 }, 5, 0), 5);
  assert.equal(reorderQuantity({ onHand: 3, reserved: 8, dailyDemand: 1.5 }, 2), 6); // reserved above on-hand: nothing available
  assert.equal(reorderQuantity({ onHand: 100, reserved: 0, dailyDemand: 1 }, 3), 0);
});

// Task item 2: tiers 5/10/15% at 10/50/100 units, highest tier reached, per-line discount rounded down, summed.
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

// Task item 3 gives the format, the six-digit padding, the 1..999999 range and "null for anything else". Which strings
// count as "anything else" (wrong digit width, lower-case, surrounding whitespace) is the convention of parseOrderNumber.
test("3 billing: invoice numbers", async () => {
  const { formatInvoiceNumber, parseInvoiceNumber } = await import("./src/billing/invoice-number.ts");
  assert.equal(formatInvoiceNumber(2026, 42), "INV-2026-000042");
  assert.equal(formatInvoiceNumber(2031, 999999), "INV-2031-999999");
  for (const bad of [0, -1, 1.5, 1_000_000, Number.NaN]) assert.throws(() => formatInvoiceNumber(2026, bad), RangeError);
  assert.deepEqual(parseInvoiceNumber("INV-2026-000042"), { year: 2026, seq: 42 });
  for (const bad of ["", "INV-2026-42", "inv-2026-000042", "INV-2026-000000", "INV-2026-0000421", " INV-2026-000042"]) assert.equal(parseInvoiceNumber(bad), null, bad);
});

// Task item 4: spaces inside braces, HTML-escaped String(value) (escapeHtml in src/notifications/escape.ts escapes & < > " '), exact error message.
test("4 notifications: renderTemplate", async () => {
  const { renderTemplate } = await import("./src/notifications/render.ts");
  assert.equal(renderTemplate("Hi {{name}}!", { name: "Ada" }), "Hi Ada!");
  assert.equal(renderTemplate("{{ a }}-{{b}}-{{ a }}", { a: 1, b: true }), "1-true-1");
  assert.equal(renderTemplate("<p>{{ msg }}</p>", { msg: `<b>"x" & 'y'</b>` }), "<p>&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;</p>");
  assert.equal(renderTemplate("no variables", {}), "no variables");
  assert.throws(() => renderTemplate("Hi {{name}}", { other: 1 }), (e: Error) => e.message === "missing variable: name");
});

// Task item 5: cancelled ignored, per UTC day (dayOf in src/reports/dates.ts), ascending. `orders` is a count: salesByMonth's convention.
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

// Task intro: "needs its own test file in test/"; the check only requires a file that mentions the module and asserts something.
for (const mod of ["inventory/reorder", "orders/bulk-discount", "billing/invoice-number", "notifications/render", "reports/sales-by-day"]) {
  test(`own test file with assertions: ${mod}`, () => assert.ok(hasTest(mod), `no test in test/ mentions ${mod} and asserts something`));
}
