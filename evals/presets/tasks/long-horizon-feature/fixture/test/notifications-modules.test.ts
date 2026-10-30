import assert from "node:assert/strict";
import { test } from "node:test";
import * as email from "../src/notifications/email.ts";
import * as sms from "../src/notifications/sms.ts";
import * as push from "../src/notifications/push.ts";
import * as digest from "../src/notifications/digest.ts";
import * as banner from "../src/notifications/banner.ts";
import * as toast from "../src/notifications/toast.ts";
import * as inbox from "../src/notifications/inbox.ts";
import * as webhook from "../src/notifications/webhook.ts";
import * as channel from "../src/notifications/channel.ts";
import * as topic from "../src/notifications/topic.ts";
import * as preference from "../src/notifications/preference.ts";
import * as quiet from "../src/notifications/quiet.ts";
import * as window from "../src/notifications/window.ts";
import * as snooze from "../src/notifications/snooze.ts";
import * as retry from "../src/notifications/retry.ts";
import * as bounce from "../src/notifications/bounce.ts";
import * as unsubscribe from "../src/notifications/unsubscribe.ts";
import * as locale from "../src/notifications/locale.ts";
import * as subject from "../src/notifications/subject.ts";
import * as footer from "../src/notifications/footer.ts";
import * as header from "../src/notifications/header.ts";
import * as signature from "../src/notifications/signature.ts";
import * as greeting from "../src/notifications/greeting.ts";
import * as reminder from "../src/notifications/reminder.ts";
import * as alert from "../src/notifications/alert.ts";
import * as escalation from "../src/notifications/escalation.ts";
import * as roster from "../src/notifications/roster.ts";
import * as pager from "../src/notifications/pager.ts";
import * as queue from "../src/notifications/queue.ts";
import * as batch from "../src/notifications/batch.ts";
import * as throttle from "../src/notifications/throttle.ts";
import * as dedupe from "../src/notifications/dedupe.ts";
import * as archive from "../src/notifications/archive.ts";

test("notifications/email", () => {
  assert.equal(email.emailScale(10), 20);
});

test("notifications/sms", () => {
  assert.equal(sms.smsLabel(1), "1 sms");
  assert.equal(sms.smsLabel(3), "3 smss");
});

test("notifications/push", () => {
  assert.equal(push.formatPush(" ab1 "), "PUS-AB1");
});

test("notifications/digest", () => {
  assert.equal(digest.isDigestValid(103), true);
  assert.equal(digest.isDigestValid(104), false);
});

test("notifications/banner", () => {
  assert.equal(banner.bannerWeight("b"), 6);
  assert.equal(banner.bannerWeight("z"), 0);
});

test("notifications/toast", () => {
  assert.equal(toast.toastScale(10), 20);
});

test("notifications/inbox", () => {
  assert.equal(inbox.inboxLabel(1), "1 inbox");
  assert.equal(inbox.inboxLabel(3), "3 inboxs");
});

test("notifications/webhook", () => {
  assert.equal(webhook.formatWebhook(" ab1 "), "WEB-AB1");
});

test("notifications/channel", () => {
  assert.equal(channel.isChannelValid(108), true);
  assert.equal(channel.isChannelValid(109), false);
});

test("notifications/topic", () => {
  assert.equal(topic.topicWeight("b"), 11);
  assert.equal(topic.topicWeight("z"), 0);
});

test("notifications/preference", () => {
  assert.equal(preference.preferenceScale(10), 20);
});

test("notifications/quiet", () => {
  assert.equal(quiet.quietLabel(1), "1 quiet");
  assert.equal(quiet.quietLabel(3), "3 quiets");
});

test("notifications/window", () => {
  assert.equal(window.formatWindow(" ab1 "), "WIN-AB1");
});

test("notifications/snooze", () => {
  assert.equal(snooze.isSnoozeValid(113), true);
  assert.equal(snooze.isSnoozeValid(114), false);
});

test("notifications/retry", () => {
  assert.equal(retry.retryWeight("b"), 16);
  assert.equal(retry.retryWeight("z"), 0);
});

test("notifications/bounce", () => {
  assert.equal(bounce.bounceScale(10), 20);
});

test("notifications/unsubscribe", () => {
  assert.equal(unsubscribe.unsubscribeLabel(1), "1 unsubscribe");
  assert.equal(unsubscribe.unsubscribeLabel(3), "3 unsubscribes");
});

test("notifications/locale", () => {
  assert.equal(locale.formatLocale(" ab1 "), "LOC-AB1");
});

test("notifications/subject", () => {
  assert.equal(subject.isSubjectValid(118), true);
  assert.equal(subject.isSubjectValid(119), false);
});

test("notifications/footer", () => {
  assert.equal(footer.footerWeight("b"), 21);
  assert.equal(footer.footerWeight("z"), 0);
});

test("notifications/header", () => {
  assert.equal(header.headerScale(10), 20);
});

test("notifications/signature", () => {
  assert.equal(signature.signatureLabel(1), "1 signature");
  assert.equal(signature.signatureLabel(3), "3 signatures");
});

test("notifications/greeting", () => {
  assert.equal(greeting.formatGreeting(" ab1 "), "GRE-AB1");
});

test("notifications/reminder", () => {
  assert.equal(reminder.isReminderValid(123), true);
  assert.equal(reminder.isReminderValid(124), false);
});

test("notifications/alert", () => {
  assert.equal(alert.alertWeight("b"), 26);
  assert.equal(alert.alertWeight("z"), 0);
});

test("notifications/escalation", () => {
  assert.equal(escalation.escalationScale(10), 20);
});

test("notifications/roster", () => {
  assert.equal(roster.rosterLabel(1), "1 roster");
  assert.equal(roster.rosterLabel(3), "3 rosters");
});

test("notifications/pager", () => {
  assert.equal(pager.formatPager(" ab1 "), "PAG-AB1");
});

test("notifications/queue", () => {
  assert.equal(queue.isQueueValid(128), true);
  assert.equal(queue.isQueueValid(129), false);
});

test("notifications/batch", () => {
  assert.equal(batch.batchWeight("b"), 31);
  assert.equal(batch.batchWeight("z"), 0);
});

test("notifications/throttle", () => {
  assert.equal(throttle.throttleScale(10), 20);
});

test("notifications/dedupe", () => {
  assert.equal(dedupe.dedupeLabel(1), "1 dedupe");
  assert.equal(dedupe.dedupeLabel(3), "3 dedupes");
});

test("notifications/archive", () => {
  assert.equal(archive.formatArchive(" ab1 "), "ARC-AB1");
});
