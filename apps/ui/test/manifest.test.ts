import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManifest } from "../src/focused/manifest.ts";

test("parseManifest accepts a bare list and wrapped lists", () => {
  const row = { vendor: "Adobe", date: "2026-09-03", amount: "59.99", currency: "USD", status: "found", note: "ok" };
  const want = [{ vendor: "Adobe", date: "2026-09-03", amount: "59.99 USD", status: "found", note: "ok" }];
  assert.deepEqual(parseManifest(JSON.stringify([row])), want);
  for (const key of ["entries", "transactions", "items", "invoices", "anything"]) assert.deepEqual(parseManifest(JSON.stringify({ [key]: [row] })), want);
});

test("parseManifest tolerates missing fields and rejects non-lists", () => {
  assert.deepEqual(parseManifest('{"transactions":[{"vendor":"Slack"}]}'), [{ vendor: "Slack", date: "", amount: "", status: "pending", note: "" }]);
  assert.deepEqual(parseManifest("[]"), []);
  assert.equal(parseManifest('{"a":[1],"b":[2]}'), null);
  assert.equal(parseManifest("nope"), null);
});
