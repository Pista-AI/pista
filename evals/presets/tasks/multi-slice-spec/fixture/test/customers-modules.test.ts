import assert from "node:assert/strict";
import { test } from "node:test";
import * as profile from "../src/customers/profile.ts";
import * as segment from "../src/customers/segment.ts";
import * as tier from "../src/customers/tier.ts";
import * as loyalty from "../src/customers/loyalty.ts";
import * as consent from "../src/customers/consent.ts";
import * as newsletter from "../src/customers/newsletter.ts";
import * as locale from "../src/customers/locale.ts";
import * as timezone from "../src/customers/timezone.ts";
import * as avatar from "../src/customers/avatar.ts";
import * as nickname from "../src/customers/nickname.ts";
import * as referral from "../src/customers/referral.ts";
import * as birthday from "../src/customers/birthday.ts";
import * as note from "../src/customers/note.ts";

test("customers/profile", () => {
  assert.equal(profile.profileLabel(1), "1 profile");
  assert.equal(profile.profileLabel(3), "3 profiles");
});

test("customers/segment", () => {
  assert.equal(segment.formatSegment(" ab1 "), "SEG-AB1");
});

test("customers/tier", () => {
  assert.equal(tier.isTierValid(102), true);
  assert.equal(tier.isTierValid(103), false);
});

test("customers/loyalty", () => {
  assert.equal(loyalty.loyaltyWeight("b"), 5);
  assert.equal(loyalty.loyaltyWeight("z"), 0);
});

test("customers/consent", () => {
  assert.equal(consent.consentScale(10), 60);
});

test("customers/newsletter", () => {
  assert.equal(newsletter.newsletterLabel(1), "1 newsletter");
  assert.equal(newsletter.newsletterLabel(3), "3 newsletters");
});

test("customers/locale", () => {
  assert.equal(locale.formatLocale(" ab1 "), "LOC-AB1");
});

test("customers/timezone", () => {
  assert.equal(timezone.isTimezoneValid(107), true);
  assert.equal(timezone.isTimezoneValid(108), false);
});

test("customers/avatar", () => {
  assert.equal(avatar.avatarWeight("b"), 10);
  assert.equal(avatar.avatarWeight("z"), 0);
});

test("customers/nickname", () => {
  assert.equal(nickname.nicknameScale(10), 60);
});

test("customers/referral", () => {
  assert.equal(referral.referralLabel(1), "1 referral");
  assert.equal(referral.referralLabel(3), "3 referrals");
});

test("customers/birthday", () => {
  assert.equal(birthday.formatBirthday(" ab1 "), "BIR-AB1");
});

test("customers/note", () => {
  assert.equal(note.isNoteValid(112), true);
  assert.equal(note.isNoteValid(113), false);
});
