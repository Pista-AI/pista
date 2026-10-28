import assert from "node:assert/strict";
import { test } from "node:test";
import { shippingCents, zoneFor } from "../src/index.ts";

test("zones follow the destination country", () => {
  assert.equal(zoneFor("SE"), "domestic");
  assert.equal(zoneFor("DK"), "nordic");
  assert.equal(zoneFor("DE"), "europe");
  assert.equal(zoneFor("US"), "world");
});

test("shipping prices", () => {
  assert.equal(shippingCents("Sverige"), 4900);
  assert.equal(shippingCents("NO"), 9900);
  assert.equal(shippingCents("Deutschland"), 14900);
});
