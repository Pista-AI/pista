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
  const rows = [{ index: 0, text: "Oct 1, 2026 Download" }, { index: 1, text: "Oct 31, 2026 Download" }]; // the row precedes the bank date T by 3 days
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

test("a later due date never makes a row the one; neighbouring rows are many", () => {
  const rows = [{ index: 0, text: "Invoice 2 Nov 2026 due 30 Nov 2026" }, { index: 1, text: "Invoice 5 Oct 2026 due 3 Nov 2026" }];
  assert.deepEqual(matchRows(rows, T), { kind: "one", index: 0 }); // row 1 matches only through its due date, a guess
  assert.deepEqual(matchRows([rows[1]!], T), { kind: "many", candidates: [1] });
  const near = ["2026-10-31", "2026-11-01", "2026-11-02"].map((text, index) => ({ index, text }));
  assert.deepEqual(matchRows(near, T), { kind: "many", candidates: [0, 1, 2] });
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
  assert.deepEqual(matchRows(mixed, sek), { kind: "one", index: 0 }); // a row with no amount does not rival one that fits
});

// --- scoring ---
// Convention: the target date is the bank date; offsetDays = bank date - row date, so a row on the 21st for a charge on the 22nd is +1.
const OCT = { date: "2026-10-22", amount: 2021.55, currency: "SEK" };
const usd = (day: number, text = "") => ({ index: day, text: `${day} Oct 2026 \u00b7 200,00 US$ ${text}` });
const eur12 = { date: "2026-10-21", amount: 12, currency: "EUR" };

test("both real OpenAI months match the USD row through the built-in rate and are verified", () => {
  for (const [date, amount, row, implied] of [["2026-09-22", 2008.2, "21 Sep 2026 \u00b7 200,00 US$", 10.041], ["2026-10-22", 2021.55, "21 Oct 2026 \u00b7 200,00 US$", 10.10775]] as const) {
    const rows = [{ index: 0, text: row }, { index: 1, text: "21 Aug 2026 \u00b7 200,00 US$" }];
    const m = scoreRows(rows, { date, amount, currency: "SEK" });
    assert.equal(m.kind, "one");
    if (m.kind !== "one") return;
    assert.equal(m.index, 0);
    assert.equal(m.amountVerified, true);
    assert.deepEqual(m.matchedBy, ["date", "amount-fx"]);
    assert.equal(m.offsetDays, 1);
    assert.ok(Math.abs(m.fxRateUsed! - 10) < 0.01);
    assert.equal(m.rowAmount, 200);
    assert.equal(m.rowCurrency, "USD");
    assert.ok(Math.abs(m.fxRateImplied! - implied) < 1e-6);
  }
  const same = scoreRows([{ index: 0, text: "21 Oct 2026 12,00 EUR" }], eur12);
  assert.ok(same.kind === "one" && same.rowAmount === 12 && same.rowCurrency === "EUR" && same.fxRateImplied === undefined);
});

test("same-day USD and EUR rows are told apart by the converted amount", () => {
  const rows = [{ index: 0, text: "21 Oct 2026 200,00 \u20ac" }, { index: 1, text: "21 Oct 2026 200,00 US$" }];
  assert.deepEqual(brief(scoreRows(rows, OCT)), { kind: "one", index: 1 });
  assert.deepEqual(brief(scoreRows([...rows].reverse(), OCT)), { kind: "one", index: 1 });
});

test("a daily-usage vendor with similar amounts is many unless a reference or an exact amount separates", () => {
  const usdRows = [18, 19, 20, 21, 22].map((d, i) => ({ index: i, text: `${d} Oct 2026 \u00b7 ${(200 + i * 0.5).toFixed(2).replace(".", ",")} US$` }));
  const many = scoreRows(usdRows, { date: "2026-10-22", amount: 2020, currency: "SEK" });
  assert.equal(many.kind, "many");
  if (many.kind === "many") assert.ok(many.details.length >= 3);
  const ref = usdRows.map((r, i) => (i === 0 ? { ...r, text: `${r.text} INV-48213` } : r));
  assert.deepEqual(brief(scoreRows(ref, { date: "2026-10-22", amount: 2020, currency: "SEK", reference: "OpenAI invoice INV-48213" })), { kind: "one", index: 0 });
  const sek = [18, 19, 20, 21, 22].map((d, i) => ({ index: i, text: `${d} Oct 2026 \u00b7 ${2010 + i},00 kr` }));
  assert.deepEqual(brief(scoreRows(sek, { date: "2026-10-22", amount: 2012, currency: "SEK" })), { kind: "one", index: 2 });
});

test("date alone never separates rows that fit the amount about equally", () => {
  const rows = [{ index: 0, text: "22 Oct 2026 207,00 US$" }, { index: 1, text: "16 Oct 2026 200,00 US$" }];
  assert.equal(scoreRows(rows, OCT).kind, "many");
});

test("rows with the same exact amount are told apart only by a reference, never by the date", () => {
  const rows = [{ index: 0, text: "22 Oct 2026 2021,55 kr" }, { index: 1, text: "17 Oct 2026 2021,55 kr INV-55120" }];
  assert.equal(scoreRows(rows, OCT).kind, "many");
  assert.deepEqual(brief(scoreRows(rows, { ...OCT, reference: "OpenAI INV-55120" })), { kind: "one", index: 1 });
});

test("a row whose best date is a later due date is not conclusive", () => {
  const sek = "issued 21 Sep 2026 due 22 Oct 2026 2021,55 kr";
  assert.equal(scoreRows([{ index: 0, text: sek }], OCT).kind, "many");
  assert.equal(scoreRows([{ index: 0, text: sek }, { index: 1, text: "22 Oct 2026 1500,00 kr" }], OCT).kind, "many");
  assert.deepEqual(brief(scoreRows([{ index: 0, text: "issued 21 Oct 2026 due 20 Nov 2026 2021,55 kr" }], OCT)), { kind: "one", index: 0 });
});

test("the built-in band stays 8 % however many rows are in the window", () => {
  const rows = [{ index: 0, text: "21 Oct 2026 200,00 US$" }, { index: 1, text: "20 Oct 2026 50,00 US$" }]; // 2000 vs 2100 is 4.8 % off; the second row's amount is far off
  const m = scoreRows(rows, { date: "2026-10-22", amount: 2100, currency: "SEK" });
  assert.ok(m.kind === "one" && m.index === 0 && m.amountVerified);
});

test("a reference picks a row whose date is worse, whole tokens only", () => {
  const rows = [{ index: 0, text: "21 Oct 2026 12,00 EUR" }, { index: 1, text: "17 Oct 2026 12,00 EUR INV-90017" }];
  assert.equal(scoreRows(rows, eur12).kind, "many"); // same amount, dates 0 and +4 days apart
  const m = scoreRows(rows, { ...eur12, reference: "Stripe INV-90017 card" });
  assert.ok(m.kind === "one" && m.index === 1 && m.matchedBy.includes("reference"));
  assert.ok(scoreRows(rows, { ...eur12, reference: "90017" }).kind === "one"); // a half of the hyphenated token
  // no substring hits, no plain words, no account numbers, no date-shaped tokens
  for (const reference of ["Stripe INV-9001", "Stripe Invoice 1234", "acct 123456789012 OpenAI"]) assert.equal(scoreRows(rows.map((r, i) => (i ? { ...r, text: `${r.text} 123456789012` } : r)), { ...eur12, reference }).kind, "many", reference);
  const dated = [rows[0]!, { index: 1, text: "17 Oct 2026 12,00 EUR 2026-10-17" }];
  assert.equal(scoreRows(dated, { ...eur12, reference: "paid 2026-10-17" }).kind, "many");
});

test("a reference never overrides an amount that does not fit", () => {
  assert.equal(scoreRows([{ index: 0, text: "21 Oct 2026 99,00 EUR INV-90017" }], { ...eur12, reference: "INV-90017" }).kind, "none");
});

test("the date window: +4 matches with a lower score; +7 and 2 days after the bank date do not", () => {
  const at = (t: string) => scoreRows([{ index: 0, text: t }], { date: "2026-10-21" });
  const full = at("21 Oct 2026"), late = at("17 Oct 2026");
  assert.ok(full.kind === "one" && late.kind === "one" && late.score < full.score && late.offsetDays === 4);
  assert.equal(at("14 Oct 2026").kind, "none");
  assert.equal(at("23 Oct 2026").kind, "none");
  const after = at("22 Oct 2026"); // a row after the bank date scores low
  assert.ok(after.kind === "one" && after.offsetDays === -1 && after.score < 0.6);
  assert.equal(scoreRows([{ index: 0, text: "14 Oct 2026 12,00 EUR" }], eur12, { maxBefore: 10 }).kind, "one");
});

test("negative amounts are excluded and a row without an amount is neutral", () => {
  assert.equal(scoreRows([{ index: 0, text: "21 Oct 2026 -200,00 US$" }], OCT).kind, "none");
  const m = scoreRows([{ index: 0, text: "21 Oct 2026 Download" }], OCT);
  assert.ok(m.kind === "one" && m.amountVerified === false && !m.matchedBy.includes("amount"));
});

test("a row without an amount beats a rival only when the rival's amount is contradicted outright", () => {
  const target = { date: "2026-10-22", amount: 2300, currency: "SEK" };
  const bare = { index: 0, text: "22 Oct 2026 Download" };
  assert.equal(scoreRows([bare, { index: 1, text: "21 Oct 2026 200,00 US$" }], target).kind, "many"); // 2000 vs 2300: low but not zero
  assert.deepEqual(brief(scoreRows([bare, { index: 1, text: "21 Oct 2026 12,00 EUR" }], target)), { kind: "one", index: 0 }); // 134 vs 2300: no fit
});

test("a caller rate narrows the band (never below 2 %); the built-in band is wider", () => {
  const rows = [{ index: 0, text: "21 Oct 2026 200,00 US$" }];
  const off = { date: "2026-10-22", amount: 2100, currency: "SEK" }; // 4.8 % above 10.0
  assert.equal(scoreRows(rows, off).kind, "one");
  assert.equal(scoreRows(rows, off, { rateFor: () => 10, band: 0.01 }).kind, "none");
  const ok = scoreRows(rows, { ...off, amount: 2000 }, { rateFor: () => 10, band: 0.01 });
  assert.ok(ok.kind === "one" && ok.fxRateUsed === 10 && ok.amountVerified);
  const two = [...rows, { index: 1, text: "20 Oct 2026 10,00 US$" }];
  const near = { ...off, amount: 2060 }; // 3 % off: inside a single row's 5 % band, partly outside the halved 2.5 %
  assert.equal((scoreRows(rows, near, { rateFor: () => 10, band: 0.05 }) as { amountVerified: boolean }).amountVerified, true);
  assert.equal((scoreRows(two, near, { rateFor: () => 10, band: 0.05 }) as { amountVerified: boolean }).amountVerified, false);
});

test("many lists evidence for the hand-off", () => {
  const m = scoreRows([usd(21), usd(22)], OCT);
  assert.equal(m.kind, "many");
  if (m.kind !== "many") return;
  assert.equal(describeCandidate(m.details.find((c) => c.index === 21)!, OCT), "row 21: 21 Oct 2026, 200,00 USD (date +1 day, amount via USD\u2192SEK 10: 2000.00 vs 2021.55)");
});
