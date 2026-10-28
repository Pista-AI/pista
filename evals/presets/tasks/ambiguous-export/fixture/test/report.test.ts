import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLE_ENTRIES, buildMonthlyReport, exportMonthlyJson, formatDate, reportTotalCents } from "../src/index.ts";

test("a monthly report keeps only that month, oldest first", () => {
  const report = buildMonthlyReport("2026-03", [...SAMPLE_ENTRIES].reverse());
  assert.deepEqual(report.entries.map((e) => e.customer), ["Astrid Berg", "Fjord AS", "Nordlys Kaffe"]);
  assert.equal(reportTotalCents(report), 348550);
});

test("dates use the Swedish DD.MM.YYYY format", () => {
  assert.equal(formatDate(new Date("2026-03-02T23:59:00Z")), "02.03.2026");
});

test("the JSON export lists date, customer, note and amount", () => {
  const json = JSON.parse(exportMonthlyJson(buildMonthlyReport("2026-03", SAMPLE_ENTRIES)));
  assert.equal(json.month, "2026-03");
  assert.deepEqual(json.rows[1], { date: "09.03.2026", customer: "Fjord AS", note: "Support hours", amount: "875.50" });
});
