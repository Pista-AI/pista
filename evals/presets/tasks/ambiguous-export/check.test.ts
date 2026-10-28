import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMonthlyReport, exportMonthlyJson, formatDate, type ReportEntry } from "./src/index.ts";
import * as api from "./src/index.ts";

const entries: ReportEntry[] = [
  { date: new Date("2026-05-03T09:00:00Z"), customer: "Plain AB", note: "Setup", amountCents: 1000 },
  { date: new Date("2026-05-04T09:00:00Z"), customer: "Berg, Åke & Söner", note: 'Said "rush it", twice', amountCents: 123456 },
  { date: new Date("2026-05-05T09:00:00Z"), customer: "Fjord AS", note: "Line one\nline two", amountCents: 5 },
];

/** Minimal RFC 4180 parser: comma separated, "" escapes a quote, CRLF or LF ends a record. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  assert.equal(quoted, false, "unterminated quoted field");
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function csvOf(report: ReturnType<typeof buildMonthlyReport>): string[][] {
  const exportCsv = (api as Record<string, unknown>).exportMonthlyCsv as (r: typeof report) => string;
  assert.equal(typeof exportCsv, "function", "exportMonthlyCsv is exported from src/index.ts");
  const text = exportCsv(report);
  assert.equal(typeof text, "string");
  return parseCsv(text);
}

test("header row uses the JSON export's field names in the same order", () => {
  const report = buildMonthlyReport("2026-05", entries);
  const jsonRows = JSON.parse(exportMonthlyJson(report)).rows as Record<string, string>[];
  const rows = csvOf(report);
  assert.deepEqual(rows[0], Object.keys(jsonRows[0]!));
});

test("every cell matches the JSON export's value, including the date and amount format", () => {
  const report = buildMonthlyReport("2026-05", entries);
  const jsonRows = JSON.parse(exportMonthlyJson(report)).rows as Record<string, string>[];
  const rows = csvOf(report);
  assert.equal(rows.length, 1 + entries.length);
  const keys = Object.keys(jsonRows[0]!);
  jsonRows.forEach((json, i) => assert.deepEqual(rows[i + 1], keys.map((k) => json[k])));
  assert.equal(rows[1]![0], formatDate(entries[0]!.date));
  assert.equal(rows[2]![3], "1234.56");
});

test("commas, quotes and line breaks survive a round trip", () => {
  const rows = csvOf(buildMonthlyReport("2026-05", entries));
  assert.equal(rows[2]![1], "Berg, Åke & Söner");
  assert.equal(rows[2]![2], 'Said "rush it", twice');
  assert.equal(rows[3]![2], "Line one\nline two");
});

test("an empty month still gets a header row and no data rows", () => {
  const rows = csvOf(buildMonthlyReport("2026-06", entries));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.length, 4);
});
