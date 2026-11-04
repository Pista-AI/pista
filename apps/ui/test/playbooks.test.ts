import test from "node:test";
import assert from "node:assert/strict";
import { describeStart, describeSteps } from "../src/lib/playbooks.ts";

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

test("shows the row selector of a click step from its target", () => {
  const lines = describeSteps([
    { kind: "click", target: { role: "link", name: "<b>x</b>", row: { match: ["date"] } } },
  ]);
  assert.deepEqual(lines, ["Pick the row matching the invoice date"]);
});

test("shows the month selector of a click step from its target", () => {
  const lines = describeSteps([
    { kind: "click", target: { role: "tab", name: "March", period: true } },
  ]);
  assert.deepEqual(lines, ["Pick the invoice's month"]);
});

test("shows the row selector of a download step from its target", () => {
  const lines = describeSteps([
    { kind: "download", target: { role: "link", row: { match: ["date", "amount"] } }, fileType: "pdf" },
  ]);
  assert.deepEqual(lines, ["Pick the row matching the invoice date", "Download (PDF)"]);
});

test("shows where a playbook starts and where it opens the list directly, without the query", () => {
  assert.deepEqual(describeStart("https://portal.example.com/?token=abc#x"), ["Starts at portal.example.com"]);
  assert.deepEqual(describeStart("https://portal.example.com/", "https://portal.example.com/account/invoices?page=2"), ["Starts at portal.example.com", "Opens the list directly at portal.example.com/account/invoices"]);
  assert.deepEqual(describeStart("not a url"), ["Starts at not a url"]);
});
