import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDates, parseAmounts, matchRows, matchPeriod } from "../src/row-match.ts";

const full = (t: string) => parseDates(t).filter((d) => d.d).map((d) => `${d.y}-${d.m}-${d.d}`);

test("date formats", () => {
  for (const t of ["2026-11-03", "3.11.2026", "3 Nov 2026", "Nov 3, 2026", "3. Nov. 2026", "3 november 2026", "3 nov. 2026", "3 noviembre 2026", "3. November 2026", "3 novembre 2026", "3rd Nov 2026"]) {
    assert.ok(full(t).includes("2026-11-3"), t);
  }
  assert.ok(full("3 déc. 2026").includes("2026-12-3"));
  assert.ok(full("3 mars 2026").includes("2026-3-3"));
  assert.ok(full("3/11/26").includes("2026-11-3"));
});

test("ambiguous numeric emits both readings; impossible ignored", () => {
  assert.deepEqual(full("03/11/2026").sort(), ["2026-11-3", "2026-3-11"]);
  assert.deepEqual(full("31/11/2026"), []);
  assert.deepEqual(full("13/11/2026"), ["2026-11-13"]);
});

test("month-only", () => {
  for (const t of ["November 2026", "nov. 2026", "november 2026"]) {
    const d = parseDates(t);
    assert.equal(d.length, 1);
    assert.deepEqual([d[0].y, d[0].m, d[0].monthOnly], [2026, 11, true]);
  }
  assert.equal(parseDates("3 Nov 2026").length, 1);
});

test("amounts", () => {
  assert.deepEqual(parseAmounts("1,234.56"), [{ value: 1234.56 }]);
  assert.deepEqual(parseAmounts("1.234,56"), [{ value: 1234.56 }]);
  assert.deepEqual(parseAmounts("1 234,56"), [{ value: 1234.56 }]);
  assert.deepEqual(parseAmounts("1 234,56 kr"), [{ value: 1234.56 }]);
  assert.deepEqual(parseAmounts("1 234,56 SEK"), [{ value: 1234.56, currency: "SEK" }]);
  assert.deepEqual(parseAmounts("$12.00"), [{ value: 12, currency: "USD" }]);
  assert.deepEqual(parseAmounts("EUR 12.00"), [{ value: 12, currency: "EUR" }]);
  assert.deepEqual(parseAmounts("€9,50"), [{ value: 9.5, currency: "EUR" }]);
  assert.deepEqual(parseAmounts("£3.10"), [{ value: 3.1, currency: "GBP" }]);
  assert.deepEqual(parseAmounts("3.11.2026"), []);
});

const T = { date: "2026-11-03" };
test("matchRows date, tolerance, none", () => {
  const rows = [{ index: 0, text: "Oct 1, 2026 Download" }, { index: 1, text: "Nov 5, 2026 Download" }];
  assert.deepEqual(matchRows(rows, T), { kind: "one", index: 1 });
  assert.deepEqual(matchRows([{ index: 4, text: "8 Nov 2026" }], T), { kind: "none" });
  assert.deepEqual(matchRows([], T), { kind: "none" });
});

test("ambiguous numeric resolved by proximity", () => {
  const rows = [{ index: 0, text: "03/11/2026" }, { index: 1, text: "01/09/2026" }];
  assert.deepEqual(matchRows(rows, T), { kind: "one", index: 0 });
});

test("amount tiebreak, currency mismatch, identical rows", () => {
  const rows = [{ index: 0, text: "3 Nov 2026 12,00 EUR" }, { index: 1, text: "3 Nov 2026 99,00 EUR" }];
  assert.deepEqual(matchRows(rows, { ...T, amount: 99, currency: "EUR" }), { kind: "one", index: 1 });
  assert.deepEqual(matchRows(rows, { ...T, amount: 99, currency: "SEK" }), { kind: "none" });
  assert.deepEqual(matchRows(rows, T), { kind: "many", candidates: [0, 1] });
  const same = [{ index: 0, text: "3 Nov 2026 12,00 EUR" }, { index: 1, text: "3 Nov 2026 12,00 EUR" }];
  assert.deepEqual(matchRows(same, { ...T, amount: 12 }), { kind: "many", candidates: [0, 1] });
});

test("amount mismatch excludes rows; no fallback to other dates", () => {
  assert.deepEqual(matchRows([{ index: 0, text: "3 Nov 2026 12,00 EUR" }], { ...T, amount: 99 }), { kind: "none" });
  const rows = [{ index: 0, text: "3 Nov 2026 12,00 EUR" }, { index: 1, text: "4 Nov 2026 99,00 EUR" }];
  assert.deepEqual(matchRows(rows, { ...T, amount: 99 }), { kind: "one", index: 1 });
});

test("row without an amount stays a candidate (no guessing)", () => {
  const rows = [{ index: 0, text: "3 Nov 2026 99,00 EUR" }, { index: 1, text: "3 Nov 2026" }];
  assert.deepEqual(matchRows(rows, { ...T, amount: 99 }), { kind: "many", candidates: [0, 1] });
});

test("matchPeriod", () => {
  const l = [{ index: 0, text: "October 2026" }, { index: 1, text: "nov. 2026" }];
  assert.deepEqual(matchPeriod(l, T), { kind: "one", index: 1 });
  assert.deepEqual(matchPeriod([{ index: 0, text: "Dec 2026" }], T), { kind: "none" });
});
