import test from "node:test";
import assert from "node:assert/strict";
import { describeSteps } from "../src/lib/playbooks.ts";

test("describes steps as plain text lines", () => {
  const lines = describeSteps([
    { kind: "navigate", url: "https://example.com/billing?x=1" },
    { kind: "signIn", origin: "https://example.com" },
    { kind: "click", target: { role: "link", name: "Download invoice" } },
    { kind: "wait", expect: { text: "Invoices" } },
    { kind: "download", fileType: "pdf" },
  ]);
  assert.deepEqual(lines, ["Open /billing?x=1", "Sign in with saved login", "Click link 'Download invoice'", "Wait for 'Invoices'", "Download (PDF)"]);
});

test("renders optional row/period selectors and keeps markup as text", () => {
  const step = { kind: "click", target: { name: "<b>x</b>" }, row: { text: "a" }, period: "month" } as never;
  assert.deepEqual(describeSteps([step]), ["Pick the invoice's month", "Pick the row matching the invoice date", "Click '<b>x</b>'"]);
});
