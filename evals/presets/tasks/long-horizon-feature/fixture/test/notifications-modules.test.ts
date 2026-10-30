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
import * as badge from "../src/notifications/badge.ts";
import * as sound from "../src/notifications/sound.ts";
import * as vibration from "../src/notifications/vibration.ts";
import * as deeplink from "../src/notifications/deeplink.ts";
import * as segment from "../src/notifications/segment.ts";

test("notifications/email", () => {
  assert.equal(email.emailScale(10), 20);
  assert.equal(email.emailShare(1, 4), 25);
  assert.equal(email.emailShare(1, 0), 0);
  assert.equal(email.emailLabel(1), "1 email");
  assert.equal(email.emailLabel(3), "3 emails");
  assert.equal(email.emailSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(email.emailSummary({}), "none");
  assert.equal(email.formatEmail(" ab1 "), "EMA-AB1");
  assert.equal(email.parseEmail("EMA-AB1"), "AB1");
  assert.equal(email.parseEmail("zzz"), undefined);
  assert.equal(email.describeEmail("EM01"), "standard email request");
  assert.match(email.describeEmail("nope"), /^unknown email code/);
});

test("notifications/sms", () => {
  assert.equal(sms.smsLabel(1), "1 sms");
  assert.equal(sms.smsLabel(3), "3 smss");
  assert.equal(sms.smsSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(sms.smsSummary({}), "none");
  assert.equal(sms.formatSms(" ab1 "), "SMS-AB1");
  assert.equal(sms.parseSms("SMS-AB1"), "AB1");
  assert.equal(sms.parseSms("zzz"), undefined);
  assert.equal(sms.isSmsValid(101), true);
  assert.equal(sms.isSmsValid(102), false);
  assert.equal(sms.clampSms(1000), 101);
  assert.equal(sms.describeSms("SM01"), "express sms batch");
  assert.match(sms.describeSms("nope"), /^unknown sms code/);
});

test("notifications/push", () => {
  assert.equal(push.formatPush(" ab1 "), "PUS-AB1");
  assert.equal(push.parsePush("PUS-AB1"), "AB1");
  assert.equal(push.parsePush("zzz"), undefined);
  assert.equal(push.isPushValid(102), true);
  assert.equal(push.isPushValid(103), false);
  assert.equal(push.clampPush(1000), 102);
  assert.equal(push.pushWeight("b"), 4);
  assert.equal(push.pushWeight("z"), 0);
  assert.equal(push.totalPushWeight(["a", "c", "z"]), 8);
  assert.equal(push.describePush("PU01"), "fragile push policy");
  assert.match(push.describePush("nope"), /^unknown push code/);
});

test("notifications/digest", () => {
  assert.equal(digest.isDigestValid(103), true);
  assert.equal(digest.isDigestValid(104), false);
  assert.equal(digest.clampDigest(1000), 103);
  assert.equal(digest.digestWeight("b"), 5);
  assert.equal(digest.digestWeight("z"), 0);
  assert.equal(digest.totalDigestWeight(["a", "c", "z"]), 10);
  assert.equal(digest.digestScale(10), 50);
  assert.equal(digest.digestShare(1, 4), 25);
  assert.equal(digest.digestShare(1, 0), 0);
  assert.equal(digest.describeDigest("DI01"), "bulky digest ticket");
  assert.match(digest.describeDigest("nope"), /^unknown digest code/);
});

test("notifications/banner", () => {
  assert.equal(banner.bannerWeight("b"), 6);
  assert.equal(banner.bannerWeight("z"), 0);
  assert.equal(banner.totalBannerWeight(["a", "c", "z"]), 12);
  assert.equal(banner.bannerScale(10), 60);
  assert.equal(banner.bannerShare(1, 4), 25);
  assert.equal(banner.bannerShare(1, 0), 0);
  assert.equal(banner.bannerLabel(1), "1 banner");
  assert.equal(banner.bannerLabel(3), "3 banners");
  assert.equal(banner.bannerSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(banner.bannerSummary({}), "none");
  assert.equal(banner.describeBanner("BA01"), "seasonal banner lane");
  assert.match(banner.describeBanner("nope"), /^unknown banner code/);
});

test("notifications/toast", () => {
  assert.equal(toast.toastScale(10), 20);
  assert.equal(toast.toastShare(1, 4), 25);
  assert.equal(toast.toastShare(1, 0), 0);
  assert.equal(toast.toastLabel(1), "1 toast");
  assert.equal(toast.toastLabel(3), "3 toasts");
  assert.equal(toast.toastSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(toast.toastSummary({}), "none");
  assert.equal(toast.formatToast(" ab1 "), "TOA-AB1");
  assert.equal(toast.parseToast("TOA-AB1"), "AB1");
  assert.equal(toast.parseToast("zzz"), undefined);
  assert.equal(toast.describeToast("TO01"), "returnable toast profile");
  assert.match(toast.describeToast("nope"), /^unknown toast code/);
});

test("notifications/inbox", () => {
  assert.equal(inbox.inboxLabel(1), "1 inbox");
  assert.equal(inbox.inboxLabel(3), "3 inboxs");
  assert.equal(inbox.inboxSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(inbox.inboxSummary({}), "none");
  assert.equal(inbox.formatInbox(" ab1 "), "INB-AB1");
  assert.equal(inbox.parseInbox("INB-AB1"), "AB1");
  assert.equal(inbox.parseInbox("zzz"), undefined);
  assert.equal(inbox.isInboxValid(106), true);
  assert.equal(inbox.isInboxValid(107), false);
  assert.equal(inbox.clampInbox(1000), 106);
  assert.equal(inbox.describeInbox("IN01"), "perishable inbox quota");
  assert.match(inbox.describeInbox("nope"), /^unknown inbox code/);
});

test("notifications/webhook", () => {
  assert.equal(webhook.formatWebhook(" ab1 "), "WEB-AB1");
  assert.equal(webhook.parseWebhook("WEB-AB1"), "AB1");
  assert.equal(webhook.parseWebhook("zzz"), undefined);
  assert.equal(webhook.isWebhookValid(107), true);
  assert.equal(webhook.isWebhookValid(108), false);
  assert.equal(webhook.clampWebhook(1000), 107);
  assert.equal(webhook.webhookWeight("b"), 9);
  assert.equal(webhook.webhookWeight("z"), 0);
  assert.equal(webhook.totalWebhookWeight(["a", "c", "z"]), 18);
  assert.equal(webhook.describeWebhook("WE01"), "regulated webhook session");
  assert.match(webhook.describeWebhook("nope"), /^unknown webhook code/);
});

test("notifications/channel", () => {
  assert.equal(channel.isChannelValid(108), true);
  assert.equal(channel.isChannelValid(109), false);
  assert.equal(channel.clampChannel(1000), 108);
  assert.equal(channel.channelWeight("b"), 10);
  assert.equal(channel.channelWeight("z"), 0);
  assert.equal(channel.totalChannelWeight(["a", "c", "z"]), 20);
  assert.equal(channel.channelScale(10), 50);
  assert.equal(channel.channelShare(1, 4), 25);
  assert.equal(channel.channelShare(1, 0), 0);
  assert.equal(channel.describeChannel("CH01"), "oversized channel plan");
  assert.match(channel.describeChannel("nope"), /^unknown channel code/);
});

test("notifications/topic", () => {
  assert.equal(topic.topicWeight("b"), 11);
  assert.equal(topic.topicWeight("z"), 0);
  assert.equal(topic.totalTopicWeight(["a", "c", "z"]), 22);
  assert.equal(topic.topicScale(10), 60);
  assert.equal(topic.topicShare(1, 4), 25);
  assert.equal(topic.topicShare(1, 0), 0);
  assert.equal(topic.topicLabel(1), "1 topic");
  assert.equal(topic.topicLabel(3), "3 topics");
  assert.equal(topic.topicSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(topic.topicSummary({}), "none");
  assert.equal(topic.describeTopic("TO01"), "premium topic entry");
  assert.match(topic.describeTopic("nope"), /^unknown topic code/);
});

test("notifications/preference", () => {
  assert.equal(preference.preferenceScale(10), 20);
  assert.equal(preference.preferenceShare(1, 4), 25);
  assert.equal(preference.preferenceShare(1, 0), 0);
  assert.equal(preference.preferenceLabel(1), "1 preference");
  assert.equal(preference.preferenceLabel(3), "3 preferences");
  assert.equal(preference.preferenceSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(preference.preferenceSummary({}), "none");
  assert.equal(preference.formatPreference(" ab1 "), "PRE-AB1");
  assert.equal(preference.parsePreference("PRE-AB1"), "AB1");
  assert.equal(preference.parsePreference("zzz"), undefined);
  assert.equal(preference.describePreference("PR01"), "discounted preference window");
  assert.match(preference.describePreference("nope"), /^unknown preference code/);
});

test("notifications/quiet", () => {
  assert.equal(quiet.quietLabel(1), "1 quiet");
  assert.equal(quiet.quietLabel(3), "3 quiets");
  assert.equal(quiet.quietSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(quiet.quietSummary({}), "none");
  assert.equal(quiet.formatQuiet(" ab1 "), "QUI-AB1");
  assert.equal(quiet.parseQuiet("QUI-AB1"), "AB1");
  assert.equal(quiet.parseQuiet("zzz"), undefined);
  assert.equal(quiet.isQuietValid(111), true);
  assert.equal(quiet.isQuietValid(112), false);
  assert.equal(quiet.clampQuiet(1000), 111);
  assert.equal(quiet.describeQuiet("QU01"), "limited quiet check");
  assert.match(quiet.describeQuiet("nope"), /^unknown quiet code/);
});

test("notifications/window", () => {
  assert.equal(window.formatWindow(" ab1 "), "WIN-AB1");
  assert.equal(window.parseWindow("WIN-AB1"), "AB1");
  assert.equal(window.parseWindow("zzz"), undefined);
  assert.equal(window.isWindowValid(112), true);
  assert.equal(window.isWindowValid(113), false);
  assert.equal(window.clampWindow(1000), 112);
  assert.equal(window.windowWeight("b"), 14);
  assert.equal(window.windowWeight("z"), 0);
  assert.equal(window.totalWindowWeight(["a", "c", "z"]), 28);
  assert.equal(window.describeWindow("WI01"), "archived window slot");
  assert.match(window.describeWindow("nope"), /^unknown window code/);
});

test("notifications/snooze", () => {
  assert.equal(snooze.isSnoozeValid(113), true);
  assert.equal(snooze.isSnoozeValid(114), false);
  assert.equal(snooze.clampSnooze(1000), 113);
  assert.equal(snooze.snoozeWeight("b"), 15);
  assert.equal(snooze.snoozeWeight("z"), 0);
  assert.equal(snooze.totalSnoozeWeight(["a", "c", "z"]), 30);
  assert.equal(snooze.snoozeScale(10), 50);
  assert.equal(snooze.snoozeShare(1, 4), 25);
  assert.equal(snooze.snoozeShare(1, 0), 0);
  assert.equal(snooze.describeSnooze("SN01"), "pending snooze group");
  assert.match(snooze.describeSnooze("nope"), /^unknown snooze code/);
});

test("notifications/retry", () => {
  assert.equal(retry.retryWeight("b"), 16);
  assert.equal(retry.retryWeight("z"), 0);
  assert.equal(retry.totalRetryWeight(["a", "c", "z"]), 32);
  assert.equal(retry.retryScale(10), 60);
  assert.equal(retry.retryShare(1, 4), 25);
  assert.equal(retry.retryShare(1, 0), 0);
  assert.equal(retry.retryLabel(1), "1 retry");
  assert.equal(retry.retryLabel(3), "3 retrys");
  assert.equal(retry.retrySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(retry.retrySummary({}), "none");
  assert.equal(retry.describeRetry("RE01"), "verified retry cap");
  assert.match(retry.describeRetry("nope"), /^unknown retry code/);
});

test("notifications/bounce", () => {
  assert.equal(bounce.bounceScale(10), 20);
  assert.equal(bounce.bounceShare(1, 4), 25);
  assert.equal(bounce.bounceShare(1, 0), 0);
  assert.equal(bounce.bounceLabel(1), "1 bounce");
  assert.equal(bounce.bounceLabel(3), "3 bounces");
  assert.equal(bounce.bounceSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(bounce.bounceSummary({}), "none");
  assert.equal(bounce.formatBounce(" ab1 "), "BOU-AB1");
  assert.equal(bounce.parseBounce("BOU-AB1"), "AB1");
  assert.equal(bounce.parseBounce("zzz"), undefined);
  assert.equal(bounce.describeBounce("BO01"), "flagged bounce ledger");
  assert.match(bounce.describeBounce("nope"), /^unknown bounce code/);
});

test("notifications/unsubscribe", () => {
  assert.equal(unsubscribe.unsubscribeLabel(1), "1 unsubscribe");
  assert.equal(unsubscribe.unsubscribeLabel(3), "3 unsubscribes");
  assert.equal(unsubscribe.unsubscribeSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(unsubscribe.unsubscribeSummary({}), "none");
  assert.equal(unsubscribe.formatUnsubscribe(" ab1 "), "UNS-AB1");
  assert.equal(unsubscribe.parseUnsubscribe("UNS-AB1"), "AB1");
  assert.equal(unsubscribe.parseUnsubscribe("zzz"), undefined);
  assert.equal(unsubscribe.isUnsubscribeValid(116), true);
  assert.equal(unsubscribe.isUnsubscribeValid(117), false);
  assert.equal(unsubscribe.clampUnsubscribe(1000), 116);
  assert.equal(unsubscribe.describeUnsubscribe("UN01"), "manual unsubscribe notice");
  assert.match(unsubscribe.describeUnsubscribe("nope"), /^unknown unsubscribe code/);
});

test("notifications/locale", () => {
  assert.equal(locale.formatLocale(" ab1 "), "LOC-AB1");
  assert.equal(locale.parseLocale("LOC-AB1"), "AB1");
  assert.equal(locale.parseLocale("zzz"), undefined);
  assert.equal(locale.isLocaleValid(117), true);
  assert.equal(locale.isLocaleValid(118), false);
  assert.equal(locale.clampLocale(1000), 117);
  assert.equal(locale.localeWeight("b"), 19);
  assert.equal(locale.localeWeight("z"), 0);
  assert.equal(locale.totalLocaleWeight(["a", "c", "z"]), 38);
  assert.equal(locale.describeLocale("LO01"), "automatic locale record");
  assert.match(locale.describeLocale("nope"), /^unknown locale code/);
});

test("notifications/subject", () => {
  assert.equal(subject.isSubjectValid(118), true);
  assert.equal(subject.isSubjectValid(119), false);
  assert.equal(subject.clampSubject(1000), 118);
  assert.equal(subject.subjectWeight("b"), 20);
  assert.equal(subject.subjectWeight("z"), 0);
  assert.equal(subject.totalSubjectWeight(["a", "c", "z"]), 40);
  assert.equal(subject.subjectScale(10), 50);
  assert.equal(subject.subjectShare(1, 4), 25);
  assert.equal(subject.subjectShare(1, 0), 0);
  assert.equal(subject.describeSubject("SU01"), "partial subject route");
  assert.match(subject.describeSubject("nope"), /^unknown subject code/);
});

test("notifications/footer", () => {
  assert.equal(footer.footerWeight("b"), 21);
  assert.equal(footer.footerWeight("z"), 0);
  assert.equal(footer.totalFooterWeight(["a", "c", "z"]), 42);
  assert.equal(footer.footerScale(10), 60);
  assert.equal(footer.footerShare(1, 4), 25);
  assert.equal(footer.footerShare(1, 0), 0);
  assert.equal(footer.footerLabel(1), "1 footer");
  assert.equal(footer.footerLabel(3), "3 footers");
  assert.equal(footer.footerSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(footer.footerSummary({}), "none");
  assert.equal(footer.describeFooter("FO01"), "primary footer rule");
  assert.match(footer.describeFooter("nope"), /^unknown footer code/);
});

test("notifications/header", () => {
  assert.equal(header.headerScale(10), 20);
  assert.equal(header.headerShare(1, 4), 25);
  assert.equal(header.headerShare(1, 0), 0);
  assert.equal(header.headerLabel(1), "1 header");
  assert.equal(header.headerLabel(3), "3 headers");
  assert.equal(header.headerSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(header.headerSummary({}), "none");
  assert.equal(header.formatHeader(" ab1 "), "HEA-AB1");
  assert.equal(header.parseHeader("HEA-AB1"), "AB1");
  assert.equal(header.parseHeader("zzz"), undefined);
  assert.equal(header.describeHeader("HE01"), "secondary header queue");
  assert.match(header.describeHeader("nope"), /^unknown header code/);
});

test("notifications/signature", () => {
  assert.equal(signature.signatureLabel(1), "1 signature");
  assert.equal(signature.signatureLabel(3), "3 signatures");
  assert.equal(signature.signatureSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(signature.signatureSummary({}), "none");
  assert.equal(signature.formatSignature(" ab1 "), "SIG-AB1");
  assert.equal(signature.parseSignature("SIG-AB1"), "AB1");
  assert.equal(signature.parseSignature("zzz"), undefined);
  assert.equal(signature.isSignatureValid(121), true);
  assert.equal(signature.isSignatureValid(122), false);
  assert.equal(signature.clampSignature(1000), 121);
  assert.equal(signature.describeSignature("SI01"), "legacy signature tier");
  assert.match(signature.describeSignature("nope"), /^unknown signature code/);
});

test("notifications/greeting", () => {
  assert.equal(greeting.formatGreeting(" ab1 "), "GRE-AB1");
  assert.equal(greeting.parseGreeting("GRE-AB1"), "AB1");
  assert.equal(greeting.parseGreeting("zzz"), undefined);
  assert.equal(greeting.isGreetingValid(122), true);
  assert.equal(greeting.isGreetingValid(123), false);
  assert.equal(greeting.clampGreeting(1000), 122);
  assert.equal(greeting.greetingWeight("b"), 24);
  assert.equal(greeting.greetingWeight("z"), 0);
  assert.equal(greeting.totalGreetingWeight(["a", "c", "z"]), 48);
  assert.equal(greeting.describeGreeting("GR01"), "trial greeting rate");
  assert.match(greeting.describeGreeting("nope"), /^unknown greeting code/);
});

test("notifications/reminder", () => {
  assert.equal(reminder.isReminderValid(123), true);
  assert.equal(reminder.isReminderValid(124), false);
  assert.equal(reminder.clampReminder(1000), 123);
  assert.equal(reminder.reminderWeight("b"), 25);
  assert.equal(reminder.reminderWeight("z"), 0);
  assert.equal(reminder.totalReminderWeight(["a", "c", "z"]), 50);
  assert.equal(reminder.reminderScale(10), 50);
  assert.equal(reminder.reminderShare(1, 4), 25);
  assert.equal(reminder.reminderShare(1, 0), 0);
  assert.equal(reminder.describeReminder("RE01"), "internal reminder cycle");
  assert.match(reminder.describeReminder("nope"), /^unknown reminder code/);
});

test("notifications/alert", () => {
  assert.equal(alert.alertWeight("b"), 26);
  assert.equal(alert.alertWeight("z"), 0);
  assert.equal(alert.totalAlertWeight(["a", "c", "z"]), 52);
  assert.equal(alert.alertScale(10), 60);
  assert.equal(alert.alertShare(1, 4), 25);
  assert.equal(alert.alertShare(1, 0), 0);
  assert.equal(alert.alertLabel(1), "1 alert");
  assert.equal(alert.alertLabel(3), "3 alerts");
  assert.equal(alert.alertSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(alert.alertSummary({}), "none");
  assert.equal(alert.describeAlert("AL01"), "external alert contact");
  assert.match(alert.describeAlert("nope"), /^unknown alert code/);
});

test("notifications/escalation", () => {
  assert.equal(escalation.escalationScale(10), 20);
  assert.equal(escalation.escalationShare(1, 4), 25);
  assert.equal(escalation.escalationShare(1, 0), 0);
  assert.equal(escalation.escalationLabel(1), "1 escalation");
  assert.equal(escalation.escalationLabel(3), "3 escalations");
  assert.equal(escalation.escalationSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(escalation.escalationSummary({}), "none");
  assert.equal(escalation.formatEscalation(" ab1 "), "ESC-AB1");
  assert.equal(escalation.parseEscalation("ESC-AB1"), "AB1");
  assert.equal(escalation.parseEscalation("zzz"), undefined);
  assert.equal(escalation.describeEscalation("ES01"), "priority escalation request");
  assert.match(escalation.describeEscalation("nope"), /^unknown escalation code/);
});

test("notifications/roster", () => {
  assert.equal(roster.rosterLabel(1), "1 roster");
  assert.equal(roster.rosterLabel(3), "3 rosters");
  assert.equal(roster.rosterSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(roster.rosterSummary({}), "none");
  assert.equal(roster.formatRoster(" ab1 "), "ROS-AB1");
  assert.equal(roster.parseRoster("ROS-AB1"), "AB1");
  assert.equal(roster.parseRoster("zzz"), undefined);
  assert.equal(roster.isRosterValid(126), true);
  assert.equal(roster.isRosterValid(127), false);
  assert.equal(roster.clampRoster(1000), 126);
  assert.equal(roster.describeRoster("RO01"), "deferred roster batch");
  assert.match(roster.describeRoster("nope"), /^unknown roster code/);
});

test("notifications/pager", () => {
  assert.equal(pager.formatPager(" ab1 "), "PAG-AB1");
  assert.equal(pager.parsePager("PAG-AB1"), "AB1");
  assert.equal(pager.parsePager("zzz"), undefined);
  assert.equal(pager.isPagerValid(127), true);
  assert.equal(pager.isPagerValid(128), false);
  assert.equal(pager.clampPager(1000), 127);
  assert.equal(pager.pagerWeight("b"), 29);
  assert.equal(pager.pagerWeight("z"), 0);
  assert.equal(pager.totalPagerWeight(["a", "c", "z"]), 58);
  assert.equal(pager.describePager("PA01"), "standard pager policy");
  assert.match(pager.describePager("nope"), /^unknown pager code/);
});

test("notifications/queue", () => {
  assert.equal(queue.isQueueValid(128), true);
  assert.equal(queue.isQueueValid(129), false);
  assert.equal(queue.clampQueue(1000), 128);
  assert.equal(queue.queueWeight("b"), 30);
  assert.equal(queue.queueWeight("z"), 0);
  assert.equal(queue.totalQueueWeight(["a", "c", "z"]), 60);
  assert.equal(queue.queueScale(10), 50);
  assert.equal(queue.queueShare(1, 4), 25);
  assert.equal(queue.queueShare(1, 0), 0);
  assert.equal(queue.describeQueue("QU01"), "express queue ticket");
  assert.match(queue.describeQueue("nope"), /^unknown queue code/);
});

test("notifications/batch", () => {
  assert.equal(batch.batchWeight("b"), 31);
  assert.equal(batch.batchWeight("z"), 0);
  assert.equal(batch.totalBatchWeight(["a", "c", "z"]), 62);
  assert.equal(batch.batchScale(10), 60);
  assert.equal(batch.batchShare(1, 4), 25);
  assert.equal(batch.batchShare(1, 0), 0);
  assert.equal(batch.batchLabel(1), "1 batch");
  assert.equal(batch.batchLabel(3), "3 batchs");
  assert.equal(batch.batchSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(batch.batchSummary({}), "none");
  assert.equal(batch.describeBatch("BA01"), "fragile batch lane");
  assert.match(batch.describeBatch("nope"), /^unknown batch code/);
});

test("notifications/throttle", () => {
  assert.equal(throttle.throttleScale(10), 20);
  assert.equal(throttle.throttleShare(1, 4), 25);
  assert.equal(throttle.throttleShare(1, 0), 0);
  assert.equal(throttle.throttleLabel(1), "1 throttle");
  assert.equal(throttle.throttleLabel(3), "3 throttles");
  assert.equal(throttle.throttleSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(throttle.throttleSummary({}), "none");
  assert.equal(throttle.formatThrottle(" ab1 "), "THR-AB1");
  assert.equal(throttle.parseThrottle("THR-AB1"), "AB1");
  assert.equal(throttle.parseThrottle("zzz"), undefined);
  assert.equal(throttle.describeThrottle("TH01"), "bulky throttle profile");
  assert.match(throttle.describeThrottle("nope"), /^unknown throttle code/);
});

test("notifications/dedupe", () => {
  assert.equal(dedupe.dedupeLabel(1), "1 dedupe");
  assert.equal(dedupe.dedupeLabel(3), "3 dedupes");
  assert.equal(dedupe.dedupeSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(dedupe.dedupeSummary({}), "none");
  assert.equal(dedupe.formatDedupe(" ab1 "), "DED-AB1");
  assert.equal(dedupe.parseDedupe("DED-AB1"), "AB1");
  assert.equal(dedupe.parseDedupe("zzz"), undefined);
  assert.equal(dedupe.isDedupeValid(131), true);
  assert.equal(dedupe.isDedupeValid(132), false);
  assert.equal(dedupe.clampDedupe(1000), 131);
  assert.equal(dedupe.describeDedupe("DE01"), "seasonal dedupe quota");
  assert.match(dedupe.describeDedupe("nope"), /^unknown dedupe code/);
});

test("notifications/archive", () => {
  assert.equal(archive.formatArchive(" ab1 "), "ARC-AB1");
  assert.equal(archive.parseArchive("ARC-AB1"), "AB1");
  assert.equal(archive.parseArchive("zzz"), undefined);
  assert.equal(archive.isArchiveValid(132), true);
  assert.equal(archive.isArchiveValid(133), false);
  assert.equal(archive.clampArchive(1000), 132);
  assert.equal(archive.archiveWeight("b"), 34);
  assert.equal(archive.archiveWeight("z"), 0);
  assert.equal(archive.totalArchiveWeight(["a", "c", "z"]), 68);
  assert.equal(archive.describeArchive("AR01"), "returnable archive session");
  assert.match(archive.describeArchive("nope"), /^unknown archive code/);
});

test("notifications/badge", () => {
  assert.equal(badge.isBadgeValid(133), true);
  assert.equal(badge.isBadgeValid(134), false);
  assert.equal(badge.clampBadge(1000), 133);
  assert.equal(badge.badgeWeight("b"), 35);
  assert.equal(badge.badgeWeight("z"), 0);
  assert.equal(badge.totalBadgeWeight(["a", "c", "z"]), 70);
  assert.equal(badge.badgeScale(10), 50);
  assert.equal(badge.badgeShare(1, 4), 25);
  assert.equal(badge.badgeShare(1, 0), 0);
  assert.equal(badge.describeBadge("BA01"), "perishable badge plan");
  assert.match(badge.describeBadge("nope"), /^unknown badge code/);
});

test("notifications/sound", () => {
  assert.equal(sound.soundWeight("b"), 36);
  assert.equal(sound.soundWeight("z"), 0);
  assert.equal(sound.totalSoundWeight(["a", "c", "z"]), 72);
  assert.equal(sound.soundScale(10), 60);
  assert.equal(sound.soundShare(1, 4), 25);
  assert.equal(sound.soundShare(1, 0), 0);
  assert.equal(sound.soundLabel(1), "1 sound");
  assert.equal(sound.soundLabel(3), "3 sounds");
  assert.equal(sound.soundSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(sound.soundSummary({}), "none");
  assert.equal(sound.describeSound("SO01"), "regulated sound entry");
  assert.match(sound.describeSound("nope"), /^unknown sound code/);
});

test("notifications/vibration", () => {
  assert.equal(vibration.vibrationScale(10), 20);
  assert.equal(vibration.vibrationShare(1, 4), 25);
  assert.equal(vibration.vibrationShare(1, 0), 0);
  assert.equal(vibration.vibrationLabel(1), "1 vibration");
  assert.equal(vibration.vibrationLabel(3), "3 vibrations");
  assert.equal(vibration.vibrationSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(vibration.vibrationSummary({}), "none");
  assert.equal(vibration.formatVibration(" ab1 "), "VIB-AB1");
  assert.equal(vibration.parseVibration("VIB-AB1"), "AB1");
  assert.equal(vibration.parseVibration("zzz"), undefined);
  assert.equal(vibration.describeVibration("VI01"), "oversized vibration window");
  assert.match(vibration.describeVibration("nope"), /^unknown vibration code/);
});

test("notifications/deeplink", () => {
  assert.equal(deeplink.deeplinkLabel(1), "1 deeplink");
  assert.equal(deeplink.deeplinkLabel(3), "3 deeplinks");
  assert.equal(deeplink.deeplinkSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(deeplink.deeplinkSummary({}), "none");
  assert.equal(deeplink.formatDeeplink(" ab1 "), "DEE-AB1");
  assert.equal(deeplink.parseDeeplink("DEE-AB1"), "AB1");
  assert.equal(deeplink.parseDeeplink("zzz"), undefined);
  assert.equal(deeplink.isDeeplinkValid(136), true);
  assert.equal(deeplink.isDeeplinkValid(137), false);
  assert.equal(deeplink.clampDeeplink(1000), 136);
  assert.equal(deeplink.describeDeeplink("DE01"), "premium deeplink check");
  assert.match(deeplink.describeDeeplink("nope"), /^unknown deeplink code/);
});

test("notifications/segment", () => {
  assert.equal(segment.formatSegment(" ab1 "), "SEG-AB1");
  assert.equal(segment.parseSegment("SEG-AB1"), "AB1");
  assert.equal(segment.parseSegment("zzz"), undefined);
  assert.equal(segment.isSegmentValid(137), true);
  assert.equal(segment.isSegmentValid(138), false);
  assert.equal(segment.clampSegment(1000), 137);
  assert.equal(segment.segmentWeight("b"), 39);
  assert.equal(segment.segmentWeight("z"), 0);
  assert.equal(segment.totalSegmentWeight(["a", "c", "z"]), 78);
  assert.equal(segment.describeSegment("SE01"), "discounted segment slot");
  assert.match(segment.describeSegment("nope"), /^unknown segment code/);
});
