import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkDiscountCents } from "../src/orders/bulk-discount.ts";

test("bulkDiscountCents", () => {
  assert.equal(bulkDiscountCents([{ sku: "a", qty: 9, unitCents: 1000 }]), 0);
  assert.equal(bulkDiscountCents([{ sku: "a", qty: 10, unitCents: 1999 }]), 999);
  assert.equal(bulkDiscountCents([{ sku: "a", qty: 50, unitCents: 100 }, { sku: "b", qty: 100, unitCents: 100 }]), 2000);
});
