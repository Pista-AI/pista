import assert from "node:assert/strict";
import { test } from "node:test";
import { runReturnsCli } from "../src/cli/returns.ts";
import { OrderStore } from "../src/orders/store.ts";
import { ReturnService } from "../src/returns/service.ts";
import { canTransition, isReturnStatus } from "../src/returns/types.ts";

function setup() {
  const store = new OrderStore();
  store.add({ id: "o-1", customerId: "c-1", status: "shipped", lines: [{ sku: "mug-01", qty: 3, unitCents: 1999 }] });
  return new ReturnService(store);
}

test("types: statuses and transitions", () => {
  assert.equal(isReturnStatus("approved"), true);
  assert.equal(isReturnStatus("nope"), false);
  assert.equal(canTransition("requested", "approved"), true);
  assert.equal(canTransition("refunded", "requested"), false);
});

test("service: request, approve, receive, refund", () => {
  const service = setup();
  const r = service.request("o-1", "mug-01", 2, " broken ");
  assert.equal(r.reason, "broken");
  service.approve(r.id);
  service.receive(r.id);
  assert.equal(service.refund(r.id).refundCents, 3998);
  assert.throws(() => service.request("o-1", "mug-01", 2, "again"), /1 left to return/);
});

test("cli: request and list", () => {
  const service = setup();
  const lines: string[] = [];
  assert.equal(runReturnsCli(["request", "o-1", "mug-01", "1", "too", "small"], service, (l) => lines.push(l)), 0);
  assert.equal(runReturnsCli(["list"], service, (l) => lines.push(l)), 0);
  assert.deepEqual(lines, ["requested ret-1: 1 x mug-01 (order o-1)", "ret-1 requested o-1 mug-01 x1"]);
  assert.equal(runReturnsCli(["bogus"], service, () => {}), 2);
});
