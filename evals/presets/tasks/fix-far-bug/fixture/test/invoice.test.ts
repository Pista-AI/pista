import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvoice, renderInvoice } from "../src/index.ts";

test("a Swedish invoice adds 25 % VAT on goods and shipping", () => {
  const inv = createInvoice("c-1", [{ productId: "licence", qty: 1 }]);
  assert.equal(inv.currency, "SEK");
  assert.equal(inv.shippingCents, 4900);
  assert.equal(inv.vatCents, 31225);
  assert.equal(inv.totalCents, 120000 + 4900 + 31225);
});

test("a German customer entered as 'Deutschland' pays 19 % in EUR", () => {
  const inv = createInvoice("c-4", [{ productId: "support", qty: 2 }]);
  assert.equal(inv.currency, "EUR");
  assert.equal(inv.vatCents, Math.round(((90000 + 14900) * 19) / 100));
});

test("a Norwegian customer entered as 'NO' pays Norwegian VAT in NOK", () => {
  const inv = createInvoice("c-2", [{ productId: "setup", qty: 1 }]);
  assert.equal(inv.currency, "NOK");
  assert.equal(inv.totalCents, 15000 + 9900 + Math.round(((15000 + 9900) * 25) / 100));
});

test("invoices render every amount with the invoice currency", () => {
  const text = renderInvoice(createInvoice("c-6", [{ productId: "setup", qty: 1 }]));
  assert.match(text, /Total  \d+\.\d\d DKK$/);
});
