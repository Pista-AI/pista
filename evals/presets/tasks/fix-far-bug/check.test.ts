import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvoice, currencyFor, normalizeCountry, regionOf, shippingCents, vatRateFor, zoneFor } from "./src/index.ts";

const SPELLINGS = ["NO", "no", " No ", "Norway", "norway", "Norge", "NORGE"];

test("every spelling of Norway normalizes to NO", () => {
  for (const s of SPELLINGS) assert.equal(normalizeCountry(s), "NO", s);
});

test("the symptom: Norwegian customers get 25 % VAT in NOK", () => {
  for (const id of ["c-2", "c-3", "c-5"]) {
    const inv = createInvoice(id, [{ productId: "licence", qty: 1 }]);
    assert.equal(inv.currency, "NOK", id);
    assert.equal(inv.shippingCents, 9900, id);
    assert.equal(inv.vatCents, Math.round(((120000 + 9900) * 25) / 100), id);
    assert.equal(inv.totalCents, 120000 + 9900 + inv.vatCents, id);
  }
});

test("the other callers of the shared normaliser agree for every spelling", () => {
  for (const s of SPELLINGS) {
    assert.equal(vatRateFor(s), 25, s);
    assert.equal(currencyFor(s), "NOK", s);
    assert.equal(zoneFor(s), "nordic", s);
    assert.equal(shippingCents(s), 9900, s);
    assert.equal(regionOf(s), "nordic", s);
  }
});

test("other countries are unchanged", () => {
  assert.deepEqual(["Sverige", "Sweden", "SE"].map(normalizeCountry), ["SE", "SE", "SE"]);
  assert.deepEqual(["Danmark", "Denmark", "dk"].map(normalizeCountry), ["DK", "DK", "DK"]);
  assert.deepEqual(["Deutschland", "Germany"].map(normalizeCountry), ["DE", "DE"]);
  assert.deepEqual(["Suomi", "Finland"].map(normalizeCountry), ["FI", "FI"]);
  assert.equal(vatRateFor("Finland"), 25.5);
  assert.equal(currencyFor("Suomi"), "EUR");
  assert.equal(zoneFor("Danmark"), "nordic");
  assert.equal(zoneFor("Sweden"), "domestic");
  assert.throws(() => normalizeCountry("Atlantis"), /Unknown country: Atlantis/);
});
