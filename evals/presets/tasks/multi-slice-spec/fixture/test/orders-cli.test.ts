import assert from "node:assert/strict";
import { test } from "node:test";
import { runOrdersCli } from "../src/cli/orders.ts";
import { OrderStore } from "../src/orders/store.ts";

test("orders cli", () => {
  const store = new OrderStore();
  store.add({ id: "o-1", customerId: "c-1", status: "open", lines: [{ sku: "mug-01", qty: 2, unitCents: 1999 }] });
  const lines: string[] = [];
  assert.equal(runOrdersCli(["show", "o-1"], store, (l) => lines.push(l)), 0);
  assert.deepEqual(lines, ["o-1 open", "  2 x mug-01 = 39.98"]);
  lines.length = 0;
  assert.equal(runOrdersCli(["show", "o-9"], store, (l) => lines.push(l)), 1);
  assert.deepEqual(lines, ["error: order not found: o-9"]);
  lines.length = 0;
  assert.equal(runOrdersCli(["bogus"], store, (l) => lines.push(l)), 2);
  assert.deepEqual(lines, ["usage: orders <show|list> [id]"]);
});
