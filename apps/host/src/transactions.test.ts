import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchVendor, parseTransactions } from "./transactions.ts";

const one = (text: string) => parseTransactions(text).lines[0]!;

describe("parseTransactions", () => {
  it("reads a tab-separated bank export and keeps the title line as not ok", () => {
    const { lines } = parseTransactions("Account statement\n2026-10-03\tTELNYX LLC\t-25.00 USD\n2026-10-04\tACME AB\t12.50 EUR\n");
    assert.equal(lines.length, 3);
    assert.deepEqual([lines[0]!.ok, lines[0]!.reason], [false, "no date or amount"]);
    assert.equal(lines[1]!.ok, false);
    assert.match(lines[1]!.reason!, /refund/);
    assert.deepEqual({ ...lines[2]! }, { lineNo: 3, raw: "2026-10-04\tACME AB\t12.50 EUR", date: "2026-10-04", amount: 12.5, currency: "EUR", merchant: "ACME AB", ok: true });
  });

  it("uses the columns of a semicolon CSV with a Swedish header", () => {
    const l = one('Bokföringsdatum;Belopp;Valuta;Mottagare\n2026-10-03;250,00;SEK;"SQ *ACME, AB"\n');
    assert.deepEqual([l.date, l.amount, l.currency, l.merchant, l.ok], ["2026-10-03", 250, "SEK", "SQ *ACME, AB", true]);
  });

  it("takes the first date column when a header names two", () => {
    const l = one("Datum,Valutadatum,Belopp,Text\n2026-10-03,2026-10-05,99.00,SPOTIFY\n");
    assert.deepEqual([l.date, l.merchant, l.ok], ["2026-10-03", "SPOTIFY", true]);
  });

  it("reads free-form lines", () => {
    const l = one("2026-10-03 TELNYX LLC 25.00 USD");
    assert.deepEqual([l.date, l.amount, l.currency, l.merchant, l.ok], ["2026-10-03", 25, "USD", "TELNYX LLC", true]);
  });

  it("reads Swedish formats", () => {
    const l = one("3 okt. 2026  Fortnox AB  1 234,56 kr");
    assert.deepEqual([l.date, l.amount, l.merchant, l.ok], ["2026-10-03", 1234.56, "Fortnox AB", true]);
  });

  it("infers day-first order from other lines", () => {
    const { lines } = parseTransactions("13/10/2026 A 5.00 EUR\n03/10/2026 B 6.00 EUR");
    assert.deepEqual(lines.map((l) => l.date), ["2026-10-13", "2026-10-03"]);
  });

  it("infers month-first order from other lines", () => {
    const { lines } = parseTransactions("10/13/2026 A 5.00 USD\n10/03/2026 B 6.00 USD");
    assert.deepEqual(lines.map((l) => l.date), ["2026-10-13", "2026-10-03"]);
  });

  it("marks a lone numeric date that could be either order as ambiguous", () => {
    const l = one("03/11/2026 ACME 25.00 USD");
    assert.deepEqual([l.ok, l.reason, l.date], [false, "ambiguous date", undefined]);
    assert.equal(one("2026-11-03 ACME 25.00 USD").ok, true);
  });

  it("leaves a bare kr currency undefined", () => {
    const l = one("2026-10-03 ACME 250,00 kr");
    assert.deepEqual([l.amount, l.currency, l.ok], [250, undefined, true]);
  });

  it("marks refunds not ok with a reason", () => {
    const [a, b, refund] = parseTransactions("2026-10-03 ACME 25.00 USD\n2026-10-04 ZED 5.00 USD\n2026-10-05 ACME REFUND -25.00 USD").lines;
    assert.deepEqual([a!.ok, b!.ok, refund!.ok], [true, true, false]);
    assert.equal(refund!.amount, -25);
    assert.match(refund!.reason!, /refund/);
  });

  it("treats the majority sign as expenses and returns them positive", () => {
    const { lines } = parseTransactions("2026-10-03 ACME -25.00 USD\n2026-10-04 ZED -5.00 USD\n2026-10-05 ACME REFUND 25.00 USD");
    assert.deepEqual(lines.map((l) => [l.ok, l.amount]), [[true, 25], [true, 5], [false, 25]]);
  });

  it("never trusts a two-digit year", () => {
    for (const t of ["24-01-13 ACME 25.00 USD", "13.01.24 ACME 25.00 USD", "01/13/24 ACME 25.00 USD"]) {
      assert.deepEqual([one(t).ok, one(t).reason], [false, "ambiguous date"], t);
    }
    // and it does not settle the order for other lines
    const { lines } = parseTransactions("13.01.24 A 5.00 EUR\n03/10/2026 B 6.00 EUR");
    assert.equal(lines[1]!.reason, "ambiguous date");
  });

  it("prefers the transaction date, then the booking date, over the value date", () => {
    assert.equal(one("Bokföringsdatum;Transaktionsdatum;Belopp;Text\n2026-10-05;2026-10-03;9,00;ACME\n").date, "2026-10-03");
    assert.equal(one("Value date,Booking date,Amount,Description\n2026-10-05,2026-10-03,9.00,ACME\n").date, "2026-10-03");
  });

  it("marks lines not ok when date or amount columns tie", () => {
    assert.equal(one("Datum,Date,Belopp,Text\n2026-10-05,2026-10-03,9.00,ACME\n").reason, "ambiguous date column");
    assert.equal(one("Datum,Belopp,Belopp,Text\n2026-10-05,9.00,10.00,ACME\n").reason, "ambiguous amount column");
  });

  it("never reads a balance column as the amount", () => {
    const l = one("Datum,Belopp,Saldo,Text\n2026-10-05,90.00,1000.00,ACME\n");
    assert.deepEqual([l.amount, l.ok], [90, true]);
  });

  it("drops an unknown currency cell", () => {
    assert.equal(one("Datum;Belopp;Valuta;Text\n2026-10-05;9,00;XYZ;ACME\n").currency, undefined);
    assert.equal(one("Datum;Belopp;Valuta;Text\n2026-10-05;9,00;sek;ACME\n").currency, "SEK");
  });

  it("keeps a line with no date or amount as not ok but skips blanks", () => {
    const { lines } = parseTransactions("hello there\n\n2026-10-03 ACME 25.00 USD");
    assert.deepEqual(lines.map((l) => [l.lineNo, l.reason]), [[1, "no date or amount"], [3, undefined]]);
  });

  it("marks two dates not ok without a header", () => {
    const l = one("2026-10-03 2026-10-05 ACME 25.00 USD");
    assert.equal(l.ok, false);
    assert.match(l.reason!, /date/);
  });

  it("marks missing merchant and two amounts not ok", () => {
    assert.equal(one("2026-10-03 25.00 USD").ok, false);
    assert.match(one("2026-10-03 ACME 25.00 USD 1 000.00 USD").reason!, /amount/);
  });

  it("keeps store numbers out of the amount", () => {
    const l = one("2026-10-03 STORE 1234 25.00 USD");
    assert.deepEqual([l.amount, l.merchant, l.ok], [25, "STORE 1234", true]);
  });
});

describe("matchVendor", () => {
  const pbs = [{ site: "acme.com", merchants: ["ACME"] }, { site: "telnyx.com", merchants: ["TELNYX"] }, { site: "acme-pay.com", merchants: ["ACME PAY"] }];
  it("matches whole words only", () => {
    assert.deepEqual(matchVendor("ACMEX INC", [pbs[0]!]), { kind: "none" });
    assert.deepEqual(matchVendor("The ACME-Shop", [pbs[0]!]), { kind: "one", site: "acme.com" });
  });
  it("strips processor prefixes and case", () => {
    assert.deepEqual(matchVendor("SQ *Telnyx LLC", pbs), { kind: "one", site: "telnyx.com" });
    assert.deepEqual(matchVendor("PAYPAL *telnyx", pbs), { kind: "one", site: "telnyx.com" });
  });
  it("returns many for several sites and none for no match", () => {
    assert.deepEqual(matchVendor("ACME PAY", pbs), { kind: "many", sites: ["acme.com", "acme-pay.com"] });
    assert.deepEqual(matchVendor("SOMETHING ELSE", pbs), { kind: "none" });
  });
  it("uses Unicode word boundaries", () => {
    assert.deepEqual(matchVendor("BARØ AB", [{ site: "bar.com", merchants: ["BAR"] }]), { kind: "none" });
    assert.deepEqual(matchVendor("BAR AB", [{ site: "bar.com", merchants: ["BAR"] }]), { kind: "one", site: "bar.com" });
  });
  it("counts one site once", () => {
    assert.deepEqual(matchVendor("ACME PAY", [{ site: "x", merchants: ["ACME", "ACME PAY"] }]), { kind: "one", site: "x" });
  });
});
