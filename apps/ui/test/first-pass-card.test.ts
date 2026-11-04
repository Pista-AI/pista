import assert from "node:assert/strict";
import { test } from "node:test";
import { askText, firstPassHeader, firstPassRows, learnedText, runWhy, type FirstPassEvent } from "../src/lib/playbook-card.ts";

const event: FirstPassEvent = {
  threadId: "t",
  fetchedCount: 2,
  total: 6,
  lines: [
    { lineNo: 1, site: "acme.test", status: "fetched", date: "2026-01-15", amount: 49, currency: "USD", file: "acme-1.pdf" },
    { lineNo: 2, site: "acme.test", status: "exists", date: "2026-01-16", amount: 12 },
    { lineNo: 3, site: "beta.test", status: "handed-off", reason: "row-not-found" },
    { lineNo: 4, site: "gamma.test", status: "declined" },
    { lineNo: 5, status: "unmatched" },
    { lineNo: 6, status: "unmatched" },
  ],
  learned: [{ site: "acme.test", keyword: "ACME" }],
  ask: [{ site: "gamma.test", keyword: "GAMMA", why: "short" }],
};

test("header counts the fetched lines and says no model was used", () => {
  assert.deepEqual(firstPassHeader(event), { title: "Fetched 2 of 6 invoices from known sites", aside: "no model used" });
});

test("header makes no no-model claim when nothing was fetched", () => {
  const h = firstPassHeader({ ...event, fetchedCount: 0 });
  assert.equal(h.aside, undefined);
  assert.equal(h.title, "Known sites: not fetched");
});

test("rows: fetched with file, handed off in plain words, declined, and unmatched lines grouped", () => {
  const rows = firstPassRows(event);
  assert.deepEqual(rows.map((r) => [r.icon, r.text, r.detail ?? r.note]), [
    ["check", "Line 1 · acme.test · 2026-01-15 · 49 USD", "acme-1.pdf"],
    ["check", "Line 2 · acme.test · 2026-01-16 · 12", "already saved"],
    ["forward", "Line 3 · beta.test · did not find that invoice in the list", "passed to the model"],
    ["stop", "Line 4 · gamma.test · you declined — ask before fetching", undefined],
    ["forward", "Lines 5–6 · no known site", "passed to the model"],
  ]);
});

test("rows: stopped lines say so, and lines with different reasons are not grouped", () => {
  const rows = firstPassRows({ ...event, lines: [{ lineNo: 1, status: "stopped", site: "a.test" }, { lineNo: 2, status: "unmatched", reason: "no date" }, { lineNo: 3, status: "unmatched" }] });
  assert.deepEqual(rows.map((r) => r.text), ["Line 1 · a.test · stopped before it ran", "Line 2 · no known site · no date", "Line 3 · no known site"]);
});

test("unknown run reasons fall back to plain words", () => {
  assert.equal(runWhy("something-new"), "could not finish");
  assert.equal(runWhy(undefined), "could not finish");
  assert.equal(runWhy("sign-in-needed"), "needs you to sign in");
});

test("footer texts", () => {
  assert.equal(learnedText(event.learned[0]!), 'Learned "ACME" for acme.test');
  assert.equal(askText(event.ask[0]!), 'Use "GAMMA" for gamma.test next time?');
});
