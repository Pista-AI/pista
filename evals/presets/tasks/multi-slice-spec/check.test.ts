import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { runReturnsCli } from "./src/cli/returns.ts";
import { DomainError } from "./src/errors.ts";
import { OrderStore } from "./src/orders/store.ts";
import { ReturnService } from "./src/returns/service.ts";
import { RETURN_STATUSES, canTransition, isReturnStatus, type ReturnStatus } from "./src/returns/types.ts";

function setup() {
  const store = new OrderStore();
  store.add({ id: "o-1", customerId: "c-1", status: "shipped", lines: [{ sku: "mug-01", qty: 3, unitCents: 1999 }, { sku: "pen-02", qty: 1, unitCents: 250 }] });
  return new ReturnService(store);
}
const fails = (fn: () => unknown, code: string, message: string) =>
  assert.throws(fn, (e: unknown) => e instanceof DomainError && e.code === code && e.message === message, `${code}: ${message}`);

test("part 1: types", () => {
  assert.deepEqual([...RETURN_STATUSES], ["requested", "approved", "rejected", "received", "refunded"]);
  for (const s of RETURN_STATUSES) assert.equal(isReturnStatus(s), true);
  for (const v of ["", "Requested", 3, null, undefined]) assert.equal(isReturnStatus(v), false);
  const ok = new Set(["requested>approved", "requested>rejected", "approved>received", "received>refunded"]);
  for (const a of RETURN_STATUSES) for (const b of RETURN_STATUSES) assert.equal(canTransition(a, b), ok.has(`${a}>${b}`), `${a} to ${b}`);
});

test("part 2: service request rules", () => {
  const s = setup();
  const r = s.request("o-1", "mug-01", 2, "  arrived broken ");
  assert.deepEqual(r, { id: "ret-1", orderId: "o-1", sku: "mug-01", qty: 2, reason: "arrived broken", status: "requested" });
  fails(() => s.request("o-1", "mug-01", 1, "   "), "reason-required", "a reason is required");
  fails(() => s.request("o-9", "mug-01", 1, "x"), "order-not-found", "order not found: o-9");
  fails(() => s.request("o-1", "cup-09", 1, "x"), "sku-not-in-order", "cup-09 is not in order o-1");
  for (const bad of [0, -1, 1.5]) fails(() => s.request("o-1", "mug-01", bad, "x"), "invalid-qty", "quantity must be a positive integer");
  fails(() => s.request("o-1", "mug-01", 2, "x"), "qty-exceeds-order", "cannot return 2 of mug-01: 1 left to return");
  assert.equal(s.request("o-1", "mug-01", 1, "x").id, "ret-2");
  assert.equal(s.request("o-1", "pen-02", 1, "x").id, "ret-3");
  fails(() => s.request("o-1", "pen-02", 1, "x"), "qty-exceeds-order", "cannot return 1 of pen-02: 0 left to return");
});

test("part 2: service lifecycle", () => {
  const s = setup();
  const a = s.request("o-1", "mug-01", 3, "x");
  assert.equal(s.approve(a.id).status, "approved");
  fails(() => s.refund(a.id), "bad-transition", "cannot go from approved to refunded");
  assert.equal(s.receive(a.id).status, "received");
  const done = s.refund(a.id);
  assert.equal(done.status, "refunded");
  assert.equal(done.refundCents, 5997);
  fails(() => s.approve(a.id), "bad-transition", "cannot go from refunded to approved");
  fails(() => s.get("ret-99"), "return-not-found", "return not found: ret-99");
  fails(() => s.approve("ret-99"), "return-not-found", "return not found: ret-99");

  const b = setup();
  const first = b.request("o-1", "mug-01", 3, "x");
  fails(() => b.reject(first.id, "  "), "note-required", "a note is required");
  const rejected = b.reject(first.id, "worn out");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.note, "worn out");
  assert.equal(b.request("o-1", "mug-01", 3, "retry").id, "ret-2", "a rejected request frees its quantity");
  assert.deepEqual(b.list().map((r) => r.id), ["ret-1", "ret-2"]);
  assert.deepEqual(b.list("rejected" as ReturnStatus).map((r) => r.id), ["ret-1"]);
  assert.deepEqual(b.list("approved"), []);
});

test("part 3: cli", () => {
  const s = setup();
  const run = (...argv: string[]) => {
    const lines: string[] = [];
    const code = runReturnsCli(argv, s, (l) => lines.push(l));
    return { code, lines };
  };
  assert.deepEqual(run("list"), { code: 0, lines: ["no returns"] });
  assert.deepEqual(run("request", "o-1", "mug-01", "2", "arrived", "broken"), { code: 0, lines: ["requested ret-1: 2 x mug-01 (order o-1)"] });
  assert.equal(s.get("ret-1").reason, "arrived broken");
  assert.deepEqual(run("request", "o-1", "mug-01", "5", "x"), { code: 1, lines: ["error: cannot return 5 of mug-01: 1 left to return"] });
  assert.deepEqual(run("request", "o-1", "mug-01", "two", "x"), { code: 2, lines: ["usage: returns <request|approve|reject|receive|refund|list> ..."] });
  assert.deepEqual(run("approve", "ret-1"), { code: 0, lines: ["ret-1 approved"] });
  assert.deepEqual(run("refund", "ret-1"), { code: 1, lines: ["error: cannot go from approved to refunded"] });
  assert.deepEqual(run("receive", "ret-1"), { code: 0, lines: ["ret-1 received"] });
  assert.deepEqual(run("refund", "ret-1"), { code: 0, lines: ["ret-1 refunded 39.98"] });
  assert.deepEqual(run("request", "o-1", "pen-02", "1", "wrong", "colour"), { code: 0, lines: ["requested ret-2: 1 x pen-02 (order o-1)"] });
  assert.deepEqual(run("reject", "ret-2", "not", "returnable"), { code: 0, lines: ["ret-2 rejected: not returnable"] });
  assert.deepEqual(run("list"), { code: 0, lines: ["ret-1 refunded o-1 mug-01 x2", "ret-2 rejected o-1 pen-02 x1"] });
  assert.deepEqual(run("list", "rejected"), { code: 0, lines: ["ret-2 rejected o-1 pen-02 x1"] });
  assert.equal(run("list", "bogus").code, 2);
  assert.equal(run("approve").code, 2);
  assert.equal(run("reject", "ret-2").code, 2);
  assert.equal(run("frobnicate").code, 2);
  assert.deepEqual(run("approve", "ret-9"), { code: 1, lines: ["error: return not found: ret-9"] });
});

test("each part has its own test file", () => {
  const sources = readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => readFileSync(`test/${f}`, "utf8"));
  for (const mod of ["returns/types", "returns/service", "cli/returns"]) assert.ok(sources.some((s) => s.includes(mod)), `no test in test/ imports ${mod}`);
});
