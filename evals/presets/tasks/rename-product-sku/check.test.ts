import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CUSTOMERS, PRODUCTS, addLine, checkout, emptyCart, findProduct, placeOrder, receipt, removeLine } from "./src/index.ts";

test("products are keyed by sku", () => {
  for (const p of PRODUCTS) {
    assert.equal(typeof p.sku, "string");
    assert.equal("id" in p, false);
  }
  assert.equal(findProduct("lamp-04").name, "Head lamp");
});

test("cart lines carry the sku", () => {
  const cart = removeLine(addLine(addLine(addLine(emptyCart(), "mug-01"), "mug-01", 2), "book-03"), "book-03");
  assert.deepEqual(cart.lines, [{ sku: "mug-01", qty: 3 }]);
});

test("orders and customers keep their ids; totals unchanged", () => {
  assert.ok(CUSTOMERS.every((c) => typeof c.id === "string"));
  const cart = addLine(addLine(emptyCart(), "pot-02"), "book-03");
  const order = placeOrder("c-1", cart, "WELCOME10");
  assert.match(order.id, /^o-\d+$/);
  assert.equal(order.customerId, "c-1");
  assert.deepEqual(order.lines, [{ sku: "pot-02", qty: 1 }, { sku: "book-03", qty: 1 }]);
  assert.deepEqual(checkout(cart, "SE", "WELCOME10"), { subtotalCents: 84800, discountCents: 8480, shippingCents: 0, totalCents: 76320, vatCents: 12696 });
  assert.match(receipt(cart, checkout(cart, "SE")), /1 x Field guide/);
});

test("no productId is left in src or test", () => {
  const files = readdirSync(".", { recursive: true, encoding: "utf8" }).filter((f) => /^(src|test)\//.test(f) && f.endsWith(".ts"));
  for (const f of files) assert.doesNotMatch(readFileSync(join(".", f), "utf8"), /productId/, f);
});
