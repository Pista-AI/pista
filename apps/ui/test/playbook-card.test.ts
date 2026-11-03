import assert from "node:assert/strict";
import { test } from "node:test";
import { playbookCardText } from "../src/lib/playbook-card.ts";

test("followed shows steps, invoice date and download", () => {
  const t = playbookCardText({ threadId: "t", kind: "followed", site: "a.com", stepCount: 4, invoice: { date: "2026-10-03" } });
  assert.equal(t.tone, "ok");
  assert.equal(t.title, "Followed playbook for a.com");
  assert.deepEqual(t.lines, ["4 steps · invoice 2026-10-03 · 1 download"]);
});

test("followed with an amount and no step count", () => {
  const t = playbookCardText({ threadId: "t", kind: "followed", site: "a.com", invoice: { date: "2026-10-03", amount: 12.5, currency: "EUR" } });
  assert.deepEqual(t.lines, ["invoice 2026-10-03 · 12.5 EUR · 1 download"]);
});

test("repairing names the step, reason and invoice", () => {
  const t = playbookCardText({ threadId: "t", kind: "repairing", site: "a.com", step: 4, reason: "Couldn't find Download", invoice: { date: "2026-10-03" } });
  assert.equal(t.tone, "warn");
  assert.equal(t.title, "Playbook step 4 failed — the assistant is repairing it");
  assert.deepEqual(t.lines, ["Step 4 · Couldn't find Download", "Looking for invoice 2026-10-03"]);
});

test("updated and learned", () => {
  assert.equal(playbookCardText({ threadId: "t", kind: "updated", site: "a.com", step: 4 }).title, "Updated playbook for a.com (step 4 changed)");
  const u = playbookCardText({ threadId: "t", kind: "updated", site: "a.com", step: 2, stepCount: 3, before: 'click link "Billing"', after: 'click link "Invoices"' });
  assert.deepEqual(u.lines, ['click link "Billing" → click link "Invoices"']);
  assert.deepEqual(playbookCardText({ threadId: "t", kind: "needs-attention", site: "a.com", step: 2, stepCount: 3 }).lines, ["Step 2 keeps failing"]);
  const l = playbookCardText({ threadId: "t", kind: "learned", site: "a.com", stepCount: 5 });
  assert.equal(l.tone, "learn");
  assert.deepEqual(l.lines, ["5 steps saved · used next time"]);
});

test("needs attention carries the reason", () => {
  const t = playbookCardText({ threadId: "t", kind: "needs-attention", site: "a.com", reason: "Failed 3 times in a row" });
  assert.equal(t.tone, "bad");
  assert.deepEqual(t.lines, ["Failed 3 times in a row"]);
});
