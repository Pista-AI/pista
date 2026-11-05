import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDates, parseAmounts, matchRows as scoreRows, matchPeriod, describeCandidate, type RowMatch } from "../src/row-match.ts";

/** The answer without its evidence, for tests that only care which row or rows. */
const brief = (m: RowMatch) => (m.kind === "one" ? { kind: m.kind, index: m.index } : m.kind === "many" ? { kind: m.kind, candidates: m.candidates } : m);
const matchRows = (...a: Parameters<typeof scoreRows>) => brief(scoreRows(...a));

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
  assert.deepEqual(parseAmounts("1 234,56 kr"), [{ value: 1234.56, currency: "KR" }]);
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
  assert.deepEqual(matchRows([{ index: 4, text: "11 Nov 2026" }], T), { kind: "none" });
  assert.deepEqual(matchRows([], T), { kind: "none" });
});


test("amount tiebreak, currency mismatch, identical rows", () => {
  const rows = [{ index: 0, text: "3 Nov 2026 12,00 EUR" }, { index: 1, text: "3 Nov 2026 99,00 EUR" }];
  assert.deepEqual(matchRows(rows, { ...T, amount: 99, currency: "EUR" }), { kind: "one", index: 1 });
  assert.deepEqual(matchRows(rows, { ...T, amount: 99, currency: "SEK" }), { kind: "none" }); // another currency, neither amount fits the band
  assert.deepEqual(matchRows(rows, T), { kind: "many", candidates: [0, 1] });
  const same = [{ index: 0, text: "3 Nov 2026 12,00 EUR" }, { index: 1, text: "3 Nov 2026 12,00 EUR" }];
  assert.deepEqual(matchRows(same, { ...T, amount: 12 }), { kind: "many", candidates: [0, 1] });
});

test("amount mismatch excludes rows; no fallback to other dates", () => {
  assert.deepEqual(matchRows([{ index: 0, text: "3 Nov 2026 12,00 EUR" }], { ...T, amount: 99 }), { kind: "none" });
  const rows = [{ index: 0, text: "3 Nov 2026 12,00 EUR" }, { index: 1, text: "4 Nov 2026 99,00 EUR" }];
  assert.deepEqual(matchRows(rows, { ...T, amount: 99 }), { kind: "one", index: 1 });
});


test("amounts: negatives, kr, times", () => {
  assert.deepEqual(parseAmounts("-49.00 EUR"), [{ value: -49, currency: "EUR" }]);
  assert.deepEqual(parseAmounts("49.00- EUR"), [{ value: -49, currency: "EUR" }]);
  assert.deepEqual(parseAmounts("(49.00) EUR"), [{ value: -49, currency: "EUR" }]);
  assert.deepEqual(parseAmounts("2026-10-05 49.00 EUR"), [{ value: 49, currency: "EUR" }]);
  assert.deepEqual(parseAmounts("49 kr", { strict: true }), [{ value: 49, currency: "KR" }]);
  assert.deepEqual(parseAmounts("Paid 14.30 and 14:30", { strict: true }), []);
  assert.deepEqual(matchRows([{ index: 0, text: "3 Nov 2026 -49.00 EUR" }], { ...T, amount: 49, currency: "EUR" }), { kind: "none" });
  assert.deepEqual(matchRows([{ index: 0, text: "3 Nov 2026 49 kr" }], { ...T, amount: 49, currency: "SEK" }), { kind: "one", index: 0 });
  assert.deepEqual(matchRows([{ index: 0, text: "3 Nov 2026 49 kr" }], { ...T, amount: 49, currency: "EUR" }), { kind: "one", index: 0 });
});

test("two dates in one row score by the nearest; neighbouring rows are many", () => {
  const rows = [{ index: 0, text: "Invoice 2 Nov 2026 due 30 Nov 2026" }, { index: 1, text: "Invoice 5 Oct 2026 due 3 Nov 2026" }];
  assert.deepEqual(matchRows(rows, T), { kind: "one", index: 1 });
  const near = ["2026-11-01", "2026-11-04", "2026-11-06"].map((text, index) => ({ index, text }));
  assert.deepEqual(matchRows(near, T), { kind: "many", candidates: [1, 2] });
});

test("an equal amount outranks rows without one", () => {
  const rows = [{ index: 0, text: "3 Nov 2026 99,00 EUR" }, { index: 1, text: "3 Nov 2026" }];
  assert.deepEqual(matchRows(rows, { ...T, amount: 99 }), { kind: "one", index: 0 });
  assert.deepEqual(matchRows([rows[1]!, { index: 2, text: "3 Nov 2026" }], { ...T, amount: 99 }), { kind: "many", candidates: [1, 2] });
});

test("ambiguous numeric dates: a guess alone is never one", () => {
  assert.deepEqual(matchRows([{ index: 0, text: "03/11/2026" }], { ...T, date: "2026-03-11" }), { kind: "many", candidates: [0] });
  const dmy = [{ index: 0, text: "03/11/2026" }, { index: 1, text: "25/11/2026" }];
  assert.deepEqual(matchRows(dmy, T), { kind: "one", index: 0 });
  assert.deepEqual(matchRows(dmy, { ...T, date: "2026-03-11" }), { kind: "none" });
  assert.deepEqual(matchRows([{ index: 0, text: "03/11/2026 49,00 EUR" }], { ...T, amount: 49, currency: "EUR" }), { kind: "one", index: 0 });
});

test("matchPeriod ranges and ambiguous labels", () => {
  assert.deepEqual(matchPeriod([{ index: 0, text: "1 Oct 2026 - 31 Oct 2026" }, { index: 1, text: "1 Nov 2026 - 30 Nov 2026" }], T), { kind: "one", index: 1 });
  assert.deepEqual(matchPeriod([{ index: 0, text: "03/11/2026" }], T), { kind: "none" });
});

test("matchPeriod", () => {
  const l = [{ index: 0, text: "October 2026" }, { index: 1, text: "nov. 2026" }];
  assert.deepEqual(matchPeriod(l, T), { kind: "one", index: 1 });
  assert.deepEqual(matchPeriod([{ index: 0, text: "Dec 2026" }], T), { kind: "none" });
});

test("a row in another currency matches by date alone and says the amount was not verified", () => {
  const rows = [{ index: 0, text: "21 Oct 2026 \u00b7 200,00 US$" }, { index: 1, text: "3 Sep 2026 \u00b7 200,00 US$" }];
  assert.deepEqual(parseAmounts("200,00 US$"), [{ value: 200, currency: "USD" }]);
  assert.deepEqual(matchRows(rows, { date: "2026-10-22", amount: 2021.55, currency: "SEK" }), { kind: "one", index: 0 });
  assert.deepEqual(matchRows(rows, { date: "2026-10-22", amount: 200, currency: "USD" }), { kind: "one", index: 0 });
  // The same currency stays strict.
  assert.deepEqual(matchRows([{ index: 0, text: "21 Oct 2026 \u00b7 99,00 SEK" }], { date: "2026-10-22", amount: 2021.55, currency: "SEK" }), { kind: "none" });
  assert.deepEqual(matchRows([{ index: 0, text: "21 Oct 2026 \u00b7 2021,55 kr" }], { date: "2026-10-22", amount: 2021.55, currency: "SEK" }), { kind: "one", index: 0 });
});

test("foreign-currency rows stay ambiguous when several could be the one", () => {
  const sek = { date: "2026-10-22", amount: 2021.55, currency: "SEK" };
  const two = [{ index: 0, text: "21 Oct 2026 \u00b7 200,00 US$" }, { index: 1, text: "22 Oct 2026 \u00b7 200,00 US$" }];
  assert.deepEqual(matchRows(two, sek), { kind: "many", candidates: [0, 1] });
  const mixed = [{ index: 0, text: "21 Oct 2026 \u00b7 200,00 US$" }, { index: 1, text: "22 Oct 2026 Paid" }];
  assert.deepEqual(matchRows(mixed, sek), { kind: "many", candidates: [0, 1] });
});

// --- scoring ---
const OCT = { date: "2026-10-22", amount: 2021.55, currency: "SEK" };
const usd = (day: number, text = "") => ({ index: day, text: `${day} Oct 2026 · 200,00 US$ ${text}` });

test("both real OpenAI months match the USD row through the built-in rate and are verified", () => {
  for (const [date, amount, row] of [["2026-09-22", 2008.2, "21 Sep 2026 · 200,00 US$"], ["2026-10-22", 2021.55, "21 Oct 2026 · 200,00 US$"]] as const) {
    const rows = [{ index: 0, text: row }, { index: 1, text: "21 Aug 2026 · 200,00 US$" }];
    const m = scoreRows(rows, { date, amount, currency: "SEK" });
    assert.equal(m.kind, "one");
    if (m.kind !== "one") return;
    assert.equal(m.index, 0);
    assert.equal(m.amountVerified, true);
    assert.deepEqual(m.matchedBy, ["amount-fx"]); // the row is a day before the invoice date: date scores high, not full
    assert.equal(m.offsetDays, -1);
    assert.ok(Math.abs(m.fxRateUsed! - 10) < 0.01);
  }
});

test("same-day USD and EUR rows are told apart by the converted amount", () => {
  const rows = [{ index: 0, text: "21 Oct 2026 200,00 €" }, { index: 1, text: "21 Oct 2026 200,00 US$" }];
  assert.deepEqual(brief(scoreRows(rows, OCT)), { kind: "one", index: 1 });
  assert.deepEqual(brief(scoreRows([...rows].reverse(), OCT)), { kind: "one", index: 1 });
});

test("a daily-usage vendor with similar amounts is many unless a reference or an exact amount separates", () => {
  const rows = [19, 20, 21, 22, 23].map((d, i) => ({ index: i, text: `${d} Oct 2026 · ${(2010 + i).toFixed(2).replace(".", ",")} kr` }));
  const m = scoreRows(rows, { date: "2026-10-21", amount: 2012, currency: "SEK" });
  assert.equal(m.kind, "one"); // an exact same-currency amount separates
  const usdRows = [19, 20, 21, 22, 23].map((d, i) => ({ index: i, text: `${d} Oct 2026 · ${(200 + i * 0.5).toFixed(2).replace(".", ",")} US$` }));
  const many = scoreRows(usdRows, { date: "2026-10-21", amount: 2020, currency: "SEK" });
  assert.equal(many.kind, "many");
  if (many.kind === "many") assert.ok(many.details.length >= 3 && many.candidates.length >= 2);
  const ref = usdRows.map((r, i) => (i === 4 ? { ...r, text: `${r.text} INV-48213` } : r));
  assert.deepEqual(brief(scoreRows(ref, { date: "2026-10-21", amount: 2020, currency: "SEK", reference: "OpenAI invoice INV-48213" })), { kind: "one", index: 4 });
});

test("a reference picks a row whose date is worse", () => {
  const rows = [{ index: 0, text: "21 Oct 2026 12,00 EUR" }, { index: 1, text: "27 Oct 2026 12,00 EUR INV-90017" }];
  assert.deepEqual(brief(scoreRows(rows, { date: "2026-10-21", amount: 12, currency: "EUR" })), { kind: "one", index: 0 });
  const m = scoreRows(rows, { date: "2026-10-21", amount: 12, currency: "EUR", reference: "Stripe INV-90017 card" });
  assert.equal(m.kind, "one");
  if (m.kind === "one") assert.ok(m.matchedBy.includes("reference") && m.index === 1);
  // plain words and short numbers are not references
  assert.equal(scoreRows(rows, { date: "2026-10-21", amount: 12, currency: "EUR", reference: "Stripe Invoice 1234" }).kind, "one"); // no reference, so no boost: the closer date wins as before
});

test("the date window: 4 days late matches with a lower score, 8 days late and 6 days early do not", () => {
  const at = (t: string) => scoreRows([{ index: 0, text: t }], { date: "2026-10-21" });
  const one = at("21 Oct 2026"), late = at("25 Oct 2026");
  assert.ok(one.kind === "one" && late.kind === "one" && late.score < one.score && late.offsetDays === 4);
  assert.equal(at("29 Oct 2026").kind, "none");
  assert.equal(at("15 Oct 2026").kind, "none");
  assert.equal(at("16 Oct 2026").kind, "none"); // at the edge the date alone is too weak
  assert.equal(scoreRows([{ index: 0, text: "16 Oct 2026 12,00 EUR" }], { date: "2026-10-21", amount: 12, currency: "EUR" }).kind, "one");
  assert.equal(scoreRows([{ index: 0, text: "29 Oct 2026 12,00 EUR" }], { date: "2026-10-21", amount: 12, currency: "EUR" }, { after: 10 }).kind, "one");
});

test("negative amounts are excluded and a row without an amount is neutral", () => {
  assert.equal(scoreRows([{ index: 0, text: "21 Oct 2026 -200,00 US$" }], OCT).kind, "none");
  const m = scoreRows([{ index: 0, text: "21 Oct 2026 Download" }], OCT);
  assert.ok(m.kind === "one" && m.amountVerified === false && !m.matchedBy.includes("amount"));
});

test("a caller rate narrows the band; the built-in band is wider", () => {
  const rows = [{ index: 0, text: "21 Oct 2026 200,00 US$" }];
  const off = { date: "2026-10-22", amount: 2100, currency: "SEK" }; // 5 % above 10.0
  assert.equal(scoreRows(rows, off).kind, "one"); // inside the built-in 8 % band
  assert.equal(scoreRows(rows, off, { rateFor: () => 10, band: 0.01 }).kind, "none");
  const ok = scoreRows(rows, { ...off, amount: 2000 }, { rateFor: () => 10, band: 0.01 });
  assert.ok(ok.kind === "one" && ok.fxRateUsed === 10 && ok.amountVerified);
});

test("many lists evidence for the hand-off", () => {
  const m = scoreRows([usd(21), usd(22)], OCT);
  assert.equal(m.kind, "many");
  if (m.kind !== "many") return;
  const line = describeCandidate(m.details.find((c) => c.index === 21)!, OCT);
  assert.equal(line, "row 21: 21 Oct 2026, 200,00 USD (date -1 day, amount via USD→SEK 10: 2000.00 vs 2021.55)");
});
