import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, isWeekend } from "../src/calendar/weekdays.ts";
import { isBusinessDay, isPublicHoliday, nextBusinessDay } from "../src/index.ts";

test("weekends are not business days", () => {
  assert.equal(isWeekend(new Date("2026-03-07T10:00:00Z")), true);
  assert.equal(isBusinessDay(new Date("2026-03-06T10:00:00Z")), true);
  assert.equal(isBusinessDay(new Date("2026-03-08T10:00:00Z")), false);
});

test("nextBusinessDay returns the day itself on a weekday and Monday on a weekend", () => {
  assert.equal(nextBusinessDay(new Date("2026-03-04T00:00:00Z")).toISOString(), "2026-03-04T00:00:00.000Z");
  assert.equal(nextBusinessDay(new Date("2026-03-07T00:00:00Z")).toISOString(), "2026-03-09T00:00:00.000Z");
});

test("the holiday calendar knows each country's days", () => {
  assert.equal(isPublicHoliday(new Date("2026-12-25T08:00:00Z"), "SE"), true);
  assert.equal(isPublicHoliday(new Date("2026-05-17T08:00:00Z"), "NO"), true);
  assert.equal(isPublicHoliday(new Date("2026-05-17T08:00:00Z"), "SE"), false);
  assert.equal(isPublicHoliday(new Date("2026-03-04T08:00:00Z"), "DE"), false);
});

test("addDays moves across month ends", () => {
  assert.equal(addDays(new Date("2026-01-31T00:00:00Z"), 1).toISOString(), "2026-02-01T00:00:00.000Z");
});
