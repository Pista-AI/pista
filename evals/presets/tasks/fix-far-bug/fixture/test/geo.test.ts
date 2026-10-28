import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCountry, regionOf } from "../src/index.ts";

test("codes are upper-cased and names are mapped", () => {
  assert.equal(normalizeCountry(" se "), "SE");
  assert.equal(normalizeCountry("Sverige"), "SE");
  assert.equal(normalizeCountry("Deutschland"), "DE");
  assert.equal(normalizeCountry("suomi"), "FI");
});

test("unknown countries are rejected", () => {
  assert.throws(() => normalizeCountry("Atlantis"), /Unknown country: Atlantis/);
});

test("regions", () => {
  assert.equal(regionOf("DK"), "nordic");
  assert.equal(regionOf("de"), "eu");
  assert.equal(regionOf("US"), "world");
});
