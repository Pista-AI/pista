import assert from "node:assert/strict";
import { test } from "node:test";
import * as ledger from "../src/billing/ledger.ts";
import * as account from "../src/billing/account.ts";
import * as balance from "../src/billing/balance.ts";
import * as payout from "../src/billing/payout.ts";
import * as charge from "../src/billing/charge.ts";
import * as capture from "../src/billing/capture.ts";
import * as authorize from "../src/billing/authorize.ts";
import * as dispute from "../src/billing/dispute.ts";
import * as chargeback from "../src/billing/chargeback.ts";
import * as settlement from "../src/billing/settlement.ts";
import * as fee from "../src/billing/fee.ts";
import * as interest from "../src/billing/interest.ts";
import * as credit from "../src/billing/credit.ts";
import * as debit from "../src/billing/debit.ts";
import * as statement from "../src/billing/statement.ts";
import * as reminder from "../src/billing/reminder.ts";
import * as dunning from "../src/billing/dunning.ts";
import * as writeoff from "../src/billing/writeoff.ts";
import * as proration from "../src/billing/proration.ts";
import * as plan from "../src/billing/plan.ts";
import * as tier from "../src/billing/tier.ts";
import * as trial from "../src/billing/trial.ts";
import * as renewal from "../src/billing/renewal.ts";
import * as cancel from "../src/billing/cancel.ts";
import * as pause from "../src/billing/pause.ts";
import * as reactivate from "../src/billing/reactivate.ts";
import * as mandate from "../src/billing/mandate.ts";
import * as token from "../src/billing/token.ts";
import * as vault from "../src/billing/vault.ts";
import * as risk from "../src/billing/risk.ts";
import * as fraud from "../src/billing/fraud.ts";
import * as taxCode from "../src/billing/tax-code.ts";
import * as remit from "../src/billing/remit.ts";
import * as auditLog from "../src/billing/audit-log.ts";
import * as escrow from "../src/billing/escrow.ts";
import * as float from "../src/billing/float.ts";
import * as hold from "../src/billing/hold.ts";
import * as release from "../src/billing/release.ts";
import * as adjust from "../src/billing/adjust.ts";

test("billing/ledger", () => {
  assert.equal(ledger.ledgerWeight("b"), 2);
  assert.equal(ledger.ledgerWeight("z"), 0);
  assert.equal(ledger.totalLedgerWeight(["a", "c", "z"]), 4);
  assert.equal(ledger.ledgerScale(10), 20);
  assert.equal(ledger.ledgerShare(1, 4), 25);
  assert.equal(ledger.ledgerShare(1, 0), 0);
  assert.equal(ledger.ledgerLabel(1), "1 ledger");
  assert.equal(ledger.ledgerLabel(3), "3 ledgers");
  assert.equal(ledger.ledgerSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(ledger.ledgerSummary({}), "none");
  assert.equal(ledger.describeLedger("LE01"), "standard ledger request");
  assert.match(ledger.describeLedger("nope"), /^unknown ledger code/);
});

test("billing/account", () => {
  assert.equal(account.accountScale(10), 30);
  assert.equal(account.accountShare(1, 4), 25);
  assert.equal(account.accountShare(1, 0), 0);
  assert.equal(account.accountLabel(1), "1 account");
  assert.equal(account.accountLabel(3), "3 accounts");
  assert.equal(account.accountSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(account.accountSummary({}), "none");
  assert.equal(account.formatAccount(" ab1 "), "ACC-AB1");
  assert.equal(account.parseAccount("ACC-AB1"), "AB1");
  assert.equal(account.parseAccount("zzz"), undefined);
  assert.equal(account.describeAccount("AC01"), "express account batch");
  assert.match(account.describeAccount("nope"), /^unknown account code/);
});

test("billing/balance", () => {
  assert.equal(balance.balanceLabel(1), "1 balance");
  assert.equal(balance.balanceLabel(3), "3 balances");
  assert.equal(balance.balanceSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(balance.balanceSummary({}), "none");
  assert.equal(balance.formatBalance(" ab1 "), "BAL-AB1");
  assert.equal(balance.parseBalance("BAL-AB1"), "AB1");
  assert.equal(balance.parseBalance("zzz"), undefined);
  assert.equal(balance.isBalanceValid(102), true);
  assert.equal(balance.isBalanceValid(103), false);
  assert.equal(balance.clampBalance(1000), 102);
  assert.equal(balance.describeBalance("BA01"), "fragile balance policy");
  assert.match(balance.describeBalance("nope"), /^unknown balance code/);
});

test("billing/payout", () => {
  assert.equal(payout.formatPayout(" ab1 "), "PAY-AB1");
  assert.equal(payout.parsePayout("PAY-AB1"), "AB1");
  assert.equal(payout.parsePayout("zzz"), undefined);
  assert.equal(payout.isPayoutValid(103), true);
  assert.equal(payout.isPayoutValid(104), false);
  assert.equal(payout.clampPayout(1000), 103);
  assert.equal(payout.payoutWeight("b"), 5);
  assert.equal(payout.payoutWeight("z"), 0);
  assert.equal(payout.totalPayoutWeight(["a", "c", "z"]), 10);
  assert.equal(payout.describePayout("PA01"), "bulky payout ticket");
  assert.match(payout.describePayout("nope"), /^unknown payout code/);
});

test("billing/charge", () => {
  assert.equal(charge.isChargeValid(104), true);
  assert.equal(charge.isChargeValid(105), false);
  assert.equal(charge.clampCharge(1000), 104);
  assert.equal(charge.chargeWeight("b"), 6);
  assert.equal(charge.chargeWeight("z"), 0);
  assert.equal(charge.totalChargeWeight(["a", "c", "z"]), 12);
  assert.equal(charge.chargeScale(10), 60);
  assert.equal(charge.chargeShare(1, 4), 25);
  assert.equal(charge.chargeShare(1, 0), 0);
  assert.equal(charge.describeCharge("CH01"), "seasonal charge lane");
  assert.match(charge.describeCharge("nope"), /^unknown charge code/);
});

test("billing/capture", () => {
  assert.equal(capture.captureWeight("b"), 7);
  assert.equal(capture.captureWeight("z"), 0);
  assert.equal(capture.totalCaptureWeight(["a", "c", "z"]), 14);
  assert.equal(capture.captureScale(10), 20);
  assert.equal(capture.captureShare(1, 4), 25);
  assert.equal(capture.captureShare(1, 0), 0);
  assert.equal(capture.captureLabel(1), "1 capture");
  assert.equal(capture.captureLabel(3), "3 captures");
  assert.equal(capture.captureSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(capture.captureSummary({}), "none");
  assert.equal(capture.describeCapture("CA01"), "returnable capture profile");
  assert.match(capture.describeCapture("nope"), /^unknown capture code/);
});

test("billing/authorize", () => {
  assert.equal(authorize.authorizeScale(10), 30);
  assert.equal(authorize.authorizeShare(1, 4), 25);
  assert.equal(authorize.authorizeShare(1, 0), 0);
  assert.equal(authorize.authorizeLabel(1), "1 authorize");
  assert.equal(authorize.authorizeLabel(3), "3 authorizes");
  assert.equal(authorize.authorizeSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(authorize.authorizeSummary({}), "none");
  assert.equal(authorize.formatAuthorize(" ab1 "), "AUT-AB1");
  assert.equal(authorize.parseAuthorize("AUT-AB1"), "AB1");
  assert.equal(authorize.parseAuthorize("zzz"), undefined);
  assert.equal(authorize.describeAuthorize("AU01"), "perishable authorize quota");
  assert.match(authorize.describeAuthorize("nope"), /^unknown authorize code/);
});

test("billing/dispute", () => {
  assert.equal(dispute.disputeLabel(1), "1 dispute");
  assert.equal(dispute.disputeLabel(3), "3 disputes");
  assert.equal(dispute.disputeSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(dispute.disputeSummary({}), "none");
  assert.equal(dispute.formatDispute(" ab1 "), "DIS-AB1");
  assert.equal(dispute.parseDispute("DIS-AB1"), "AB1");
  assert.equal(dispute.parseDispute("zzz"), undefined);
  assert.equal(dispute.isDisputeValid(107), true);
  assert.equal(dispute.isDisputeValid(108), false);
  assert.equal(dispute.clampDispute(1000), 107);
  assert.equal(dispute.describeDispute("DI01"), "regulated dispute session");
  assert.match(dispute.describeDispute("nope"), /^unknown dispute code/);
});

test("billing/chargeback", () => {
  assert.equal(chargeback.formatChargeback(" ab1 "), "CHA-AB1");
  assert.equal(chargeback.parseChargeback("CHA-AB1"), "AB1");
  assert.equal(chargeback.parseChargeback("zzz"), undefined);
  assert.equal(chargeback.isChargebackValid(108), true);
  assert.equal(chargeback.isChargebackValid(109), false);
  assert.equal(chargeback.clampChargeback(1000), 108);
  assert.equal(chargeback.chargebackWeight("b"), 10);
  assert.equal(chargeback.chargebackWeight("z"), 0);
  assert.equal(chargeback.totalChargebackWeight(["a", "c", "z"]), 20);
  assert.equal(chargeback.describeChargeback("CH01"), "oversized chargeback plan");
  assert.match(chargeback.describeChargeback("nope"), /^unknown chargeback code/);
});

test("billing/settlement", () => {
  assert.equal(settlement.isSettlementValid(109), true);
  assert.equal(settlement.isSettlementValid(110), false);
  assert.equal(settlement.clampSettlement(1000), 109);
  assert.equal(settlement.settlementWeight("b"), 11);
  assert.equal(settlement.settlementWeight("z"), 0);
  assert.equal(settlement.totalSettlementWeight(["a", "c", "z"]), 22);
  assert.equal(settlement.settlementScale(10), 60);
  assert.equal(settlement.settlementShare(1, 4), 25);
  assert.equal(settlement.settlementShare(1, 0), 0);
  assert.equal(settlement.describeSettlement("SE01"), "premium settlement entry");
  assert.match(settlement.describeSettlement("nope"), /^unknown settlement code/);
});

test("billing/fee", () => {
  assert.equal(fee.feeWeight("b"), 12);
  assert.equal(fee.feeWeight("z"), 0);
  assert.equal(fee.totalFeeWeight(["a", "c", "z"]), 24);
  assert.equal(fee.feeScale(10), 20);
  assert.equal(fee.feeShare(1, 4), 25);
  assert.equal(fee.feeShare(1, 0), 0);
  assert.equal(fee.feeLabel(1), "1 fee");
  assert.equal(fee.feeLabel(3), "3 fees");
  assert.equal(fee.feeSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(fee.feeSummary({}), "none");
  assert.equal(fee.describeFee("FE01"), "discounted fee window");
  assert.match(fee.describeFee("nope"), /^unknown fee code/);
});

test("billing/interest", () => {
  assert.equal(interest.interestScale(10), 30);
  assert.equal(interest.interestShare(1, 4), 25);
  assert.equal(interest.interestShare(1, 0), 0);
  assert.equal(interest.interestLabel(1), "1 interest");
  assert.equal(interest.interestLabel(3), "3 interests");
  assert.equal(interest.interestSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(interest.interestSummary({}), "none");
  assert.equal(interest.formatInterest(" ab1 "), "INT-AB1");
  assert.equal(interest.parseInterest("INT-AB1"), "AB1");
  assert.equal(interest.parseInterest("zzz"), undefined);
  assert.equal(interest.describeInterest("IN01"), "limited interest check");
  assert.match(interest.describeInterest("nope"), /^unknown interest code/);
});

test("billing/credit", () => {
  assert.equal(credit.creditLabel(1), "1 credit");
  assert.equal(credit.creditLabel(3), "3 credits");
  assert.equal(credit.creditSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(credit.creditSummary({}), "none");
  assert.equal(credit.formatCredit(" ab1 "), "CRE-AB1");
  assert.equal(credit.parseCredit("CRE-AB1"), "AB1");
  assert.equal(credit.parseCredit("zzz"), undefined);
  assert.equal(credit.isCreditValid(112), true);
  assert.equal(credit.isCreditValid(113), false);
  assert.equal(credit.clampCredit(1000), 112);
  assert.equal(credit.describeCredit("CR01"), "archived credit slot");
  assert.match(credit.describeCredit("nope"), /^unknown credit code/);
});

test("billing/debit", () => {
  assert.equal(debit.formatDebit(" ab1 "), "DEB-AB1");
  assert.equal(debit.parseDebit("DEB-AB1"), "AB1");
  assert.equal(debit.parseDebit("zzz"), undefined);
  assert.equal(debit.isDebitValid(113), true);
  assert.equal(debit.isDebitValid(114), false);
  assert.equal(debit.clampDebit(1000), 113);
  assert.equal(debit.debitWeight("b"), 15);
  assert.equal(debit.debitWeight("z"), 0);
  assert.equal(debit.totalDebitWeight(["a", "c", "z"]), 30);
  assert.equal(debit.describeDebit("DE01"), "pending debit group");
  assert.match(debit.describeDebit("nope"), /^unknown debit code/);
});

test("billing/statement", () => {
  assert.equal(statement.isStatementValid(114), true);
  assert.equal(statement.isStatementValid(115), false);
  assert.equal(statement.clampStatement(1000), 114);
  assert.equal(statement.statementWeight("b"), 16);
  assert.equal(statement.statementWeight("z"), 0);
  assert.equal(statement.totalStatementWeight(["a", "c", "z"]), 32);
  assert.equal(statement.statementScale(10), 60);
  assert.equal(statement.statementShare(1, 4), 25);
  assert.equal(statement.statementShare(1, 0), 0);
  assert.equal(statement.describeStatement("ST01"), "verified statement cap");
  assert.match(statement.describeStatement("nope"), /^unknown statement code/);
});

test("billing/reminder", () => {
  assert.equal(reminder.reminderWeight("b"), 17);
  assert.equal(reminder.reminderWeight("z"), 0);
  assert.equal(reminder.totalReminderWeight(["a", "c", "z"]), 34);
  assert.equal(reminder.reminderScale(10), 20);
  assert.equal(reminder.reminderShare(1, 4), 25);
  assert.equal(reminder.reminderShare(1, 0), 0);
  assert.equal(reminder.reminderLabel(1), "1 reminder");
  assert.equal(reminder.reminderLabel(3), "3 reminders");
  assert.equal(reminder.reminderSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(reminder.reminderSummary({}), "none");
  assert.equal(reminder.describeReminder("RE01"), "flagged reminder ledger");
  assert.match(reminder.describeReminder("nope"), /^unknown reminder code/);
});

test("billing/dunning", () => {
  assert.equal(dunning.dunningScale(10), 30);
  assert.equal(dunning.dunningShare(1, 4), 25);
  assert.equal(dunning.dunningShare(1, 0), 0);
  assert.equal(dunning.dunningLabel(1), "1 dunning");
  assert.equal(dunning.dunningLabel(3), "3 dunnings");
  assert.equal(dunning.dunningSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(dunning.dunningSummary({}), "none");
  assert.equal(dunning.formatDunning(" ab1 "), "DUN-AB1");
  assert.equal(dunning.parseDunning("DUN-AB1"), "AB1");
  assert.equal(dunning.parseDunning("zzz"), undefined);
  assert.equal(dunning.describeDunning("DU01"), "manual dunning notice");
  assert.match(dunning.describeDunning("nope"), /^unknown dunning code/);
});

test("billing/writeoff", () => {
  assert.equal(writeoff.writeoffLabel(1), "1 writeoff");
  assert.equal(writeoff.writeoffLabel(3), "3 writeoffs");
  assert.equal(writeoff.writeoffSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(writeoff.writeoffSummary({}), "none");
  assert.equal(writeoff.formatWriteoff(" ab1 "), "WRI-AB1");
  assert.equal(writeoff.parseWriteoff("WRI-AB1"), "AB1");
  assert.equal(writeoff.parseWriteoff("zzz"), undefined);
  assert.equal(writeoff.isWriteoffValid(117), true);
  assert.equal(writeoff.isWriteoffValid(118), false);
  assert.equal(writeoff.clampWriteoff(1000), 117);
  assert.equal(writeoff.describeWriteoff("WR01"), "automatic writeoff record");
  assert.match(writeoff.describeWriteoff("nope"), /^unknown writeoff code/);
});

test("billing/proration", () => {
  assert.equal(proration.formatProration(" ab1 "), "PRO-AB1");
  assert.equal(proration.parseProration("PRO-AB1"), "AB1");
  assert.equal(proration.parseProration("zzz"), undefined);
  assert.equal(proration.isProrationValid(118), true);
  assert.equal(proration.isProrationValid(119), false);
  assert.equal(proration.clampProration(1000), 118);
  assert.equal(proration.prorationWeight("b"), 20);
  assert.equal(proration.prorationWeight("z"), 0);
  assert.equal(proration.totalProrationWeight(["a", "c", "z"]), 40);
  assert.equal(proration.describeProration("PR01"), "partial proration route");
  assert.match(proration.describeProration("nope"), /^unknown proration code/);
});

test("billing/plan", () => {
  assert.equal(plan.isPlanValid(119), true);
  assert.equal(plan.isPlanValid(120), false);
  assert.equal(plan.clampPlan(1000), 119);
  assert.equal(plan.planWeight("b"), 21);
  assert.equal(plan.planWeight("z"), 0);
  assert.equal(plan.totalPlanWeight(["a", "c", "z"]), 42);
  assert.equal(plan.planScale(10), 60);
  assert.equal(plan.planShare(1, 4), 25);
  assert.equal(plan.planShare(1, 0), 0);
  assert.equal(plan.describePlan("PL01"), "primary plan rule");
  assert.match(plan.describePlan("nope"), /^unknown plan code/);
});

test("billing/tier", () => {
  assert.equal(tier.tierWeight("b"), 22);
  assert.equal(tier.tierWeight("z"), 0);
  assert.equal(tier.totalTierWeight(["a", "c", "z"]), 44);
  assert.equal(tier.tierScale(10), 20);
  assert.equal(tier.tierShare(1, 4), 25);
  assert.equal(tier.tierShare(1, 0), 0);
  assert.equal(tier.tierLabel(1), "1 tier");
  assert.equal(tier.tierLabel(3), "3 tiers");
  assert.equal(tier.tierSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(tier.tierSummary({}), "none");
  assert.equal(tier.describeTier("TI01"), "secondary tier queue");
  assert.match(tier.describeTier("nope"), /^unknown tier code/);
});

test("billing/trial", () => {
  assert.equal(trial.trialScale(10), 30);
  assert.equal(trial.trialShare(1, 4), 25);
  assert.equal(trial.trialShare(1, 0), 0);
  assert.equal(trial.trialLabel(1), "1 trial");
  assert.equal(trial.trialLabel(3), "3 trials");
  assert.equal(trial.trialSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(trial.trialSummary({}), "none");
  assert.equal(trial.formatTrial(" ab1 "), "TRI-AB1");
  assert.equal(trial.parseTrial("TRI-AB1"), "AB1");
  assert.equal(trial.parseTrial("zzz"), undefined);
  assert.equal(trial.describeTrial("TR01"), "legacy trial tier");
  assert.match(trial.describeTrial("nope"), /^unknown trial code/);
});

test("billing/renewal", () => {
  assert.equal(renewal.renewalLabel(1), "1 renewal");
  assert.equal(renewal.renewalLabel(3), "3 renewals");
  assert.equal(renewal.renewalSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(renewal.renewalSummary({}), "none");
  assert.equal(renewal.formatRenewal(" ab1 "), "REN-AB1");
  assert.equal(renewal.parseRenewal("REN-AB1"), "AB1");
  assert.equal(renewal.parseRenewal("zzz"), undefined);
  assert.equal(renewal.isRenewalValid(122), true);
  assert.equal(renewal.isRenewalValid(123), false);
  assert.equal(renewal.clampRenewal(1000), 122);
  assert.equal(renewal.describeRenewal("RE01"), "trial renewal rate");
  assert.match(renewal.describeRenewal("nope"), /^unknown renewal code/);
});

test("billing/cancel", () => {
  assert.equal(cancel.formatCancel(" ab1 "), "CAN-AB1");
  assert.equal(cancel.parseCancel("CAN-AB1"), "AB1");
  assert.equal(cancel.parseCancel("zzz"), undefined);
  assert.equal(cancel.isCancelValid(123), true);
  assert.equal(cancel.isCancelValid(124), false);
  assert.equal(cancel.clampCancel(1000), 123);
  assert.equal(cancel.cancelWeight("b"), 25);
  assert.equal(cancel.cancelWeight("z"), 0);
  assert.equal(cancel.totalCancelWeight(["a", "c", "z"]), 50);
  assert.equal(cancel.describeCancel("CA01"), "internal cancel cycle");
  assert.match(cancel.describeCancel("nope"), /^unknown cancel code/);
});

test("billing/pause", () => {
  assert.equal(pause.isPauseValid(124), true);
  assert.equal(pause.isPauseValid(125), false);
  assert.equal(pause.clampPause(1000), 124);
  assert.equal(pause.pauseWeight("b"), 26);
  assert.equal(pause.pauseWeight("z"), 0);
  assert.equal(pause.totalPauseWeight(["a", "c", "z"]), 52);
  assert.equal(pause.pauseScale(10), 60);
  assert.equal(pause.pauseShare(1, 4), 25);
  assert.equal(pause.pauseShare(1, 0), 0);
  assert.equal(pause.describePause("PA01"), "external pause contact");
  assert.match(pause.describePause("nope"), /^unknown pause code/);
});

test("billing/reactivate", () => {
  assert.equal(reactivate.reactivateWeight("b"), 27);
  assert.equal(reactivate.reactivateWeight("z"), 0);
  assert.equal(reactivate.totalReactivateWeight(["a", "c", "z"]), 54);
  assert.equal(reactivate.reactivateScale(10), 20);
  assert.equal(reactivate.reactivateShare(1, 4), 25);
  assert.equal(reactivate.reactivateShare(1, 0), 0);
  assert.equal(reactivate.reactivateLabel(1), "1 reactivate");
  assert.equal(reactivate.reactivateLabel(3), "3 reactivates");
  assert.equal(reactivate.reactivateSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(reactivate.reactivateSummary({}), "none");
  assert.equal(reactivate.describeReactivate("RE01"), "priority reactivate request");
  assert.match(reactivate.describeReactivate("nope"), /^unknown reactivate code/);
});

test("billing/mandate", () => {
  assert.equal(mandate.mandateScale(10), 30);
  assert.equal(mandate.mandateShare(1, 4), 25);
  assert.equal(mandate.mandateShare(1, 0), 0);
  assert.equal(mandate.mandateLabel(1), "1 mandate");
  assert.equal(mandate.mandateLabel(3), "3 mandates");
  assert.equal(mandate.mandateSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(mandate.mandateSummary({}), "none");
  assert.equal(mandate.formatMandate(" ab1 "), "MAN-AB1");
  assert.equal(mandate.parseMandate("MAN-AB1"), "AB1");
  assert.equal(mandate.parseMandate("zzz"), undefined);
  assert.equal(mandate.describeMandate("MA01"), "deferred mandate batch");
  assert.match(mandate.describeMandate("nope"), /^unknown mandate code/);
});

test("billing/token", () => {
  assert.equal(token.tokenLabel(1), "1 token");
  assert.equal(token.tokenLabel(3), "3 tokens");
  assert.equal(token.tokenSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(token.tokenSummary({}), "none");
  assert.equal(token.formatToken(" ab1 "), "TOK-AB1");
  assert.equal(token.parseToken("TOK-AB1"), "AB1");
  assert.equal(token.parseToken("zzz"), undefined);
  assert.equal(token.isTokenValid(127), true);
  assert.equal(token.isTokenValid(128), false);
  assert.equal(token.clampToken(1000), 127);
  assert.equal(token.describeToken("TO01"), "standard token policy");
  assert.match(token.describeToken("nope"), /^unknown token code/);
});

test("billing/vault", () => {
  assert.equal(vault.formatVault(" ab1 "), "VAU-AB1");
  assert.equal(vault.parseVault("VAU-AB1"), "AB1");
  assert.equal(vault.parseVault("zzz"), undefined);
  assert.equal(vault.isVaultValid(128), true);
  assert.equal(vault.isVaultValid(129), false);
  assert.equal(vault.clampVault(1000), 128);
  assert.equal(vault.vaultWeight("b"), 30);
  assert.equal(vault.vaultWeight("z"), 0);
  assert.equal(vault.totalVaultWeight(["a", "c", "z"]), 60);
  assert.equal(vault.describeVault("VA01"), "express vault ticket");
  assert.match(vault.describeVault("nope"), /^unknown vault code/);
});

test("billing/risk", () => {
  assert.equal(risk.isRiskValid(129), true);
  assert.equal(risk.isRiskValid(130), false);
  assert.equal(risk.clampRisk(1000), 129);
  assert.equal(risk.riskWeight("b"), 31);
  assert.equal(risk.riskWeight("z"), 0);
  assert.equal(risk.totalRiskWeight(["a", "c", "z"]), 62);
  assert.equal(risk.riskScale(10), 60);
  assert.equal(risk.riskShare(1, 4), 25);
  assert.equal(risk.riskShare(1, 0), 0);
  assert.equal(risk.describeRisk("RI01"), "fragile risk lane");
  assert.match(risk.describeRisk("nope"), /^unknown risk code/);
});

test("billing/fraud", () => {
  assert.equal(fraud.fraudWeight("b"), 32);
  assert.equal(fraud.fraudWeight("z"), 0);
  assert.equal(fraud.totalFraudWeight(["a", "c", "z"]), 64);
  assert.equal(fraud.fraudScale(10), 20);
  assert.equal(fraud.fraudShare(1, 4), 25);
  assert.equal(fraud.fraudShare(1, 0), 0);
  assert.equal(fraud.fraudLabel(1), "1 fraud");
  assert.equal(fraud.fraudLabel(3), "3 frauds");
  assert.equal(fraud.fraudSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(fraud.fraudSummary({}), "none");
  assert.equal(fraud.describeFraud("FR01"), "bulky fraud profile");
  assert.match(fraud.describeFraud("nope"), /^unknown fraud code/);
});

test("billing/tax-code", () => {
  assert.equal(taxCode.taxCodeScale(10), 30);
  assert.equal(taxCode.taxCodeShare(1, 4), 25);
  assert.equal(taxCode.taxCodeShare(1, 0), 0);
  assert.equal(taxCode.taxCodeLabel(1), "1 tax-code");
  assert.equal(taxCode.taxCodeLabel(3), "3 tax-codes");
  assert.equal(taxCode.taxCodeSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(taxCode.taxCodeSummary({}), "none");
  assert.equal(taxCode.formatTaxCode(" ab1 "), "TAX-AB1");
  assert.equal(taxCode.parseTaxCode("TAX-AB1"), "AB1");
  assert.equal(taxCode.parseTaxCode("zzz"), undefined);
  assert.equal(taxCode.describeTaxCode("TA01"), "seasonal tax-code quota");
  assert.match(taxCode.describeTaxCode("nope"), /^unknown tax-code code/);
});

test("billing/remit", () => {
  assert.equal(remit.remitLabel(1), "1 remit");
  assert.equal(remit.remitLabel(3), "3 remits");
  assert.equal(remit.remitSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(remit.remitSummary({}), "none");
  assert.equal(remit.formatRemit(" ab1 "), "REM-AB1");
  assert.equal(remit.parseRemit("REM-AB1"), "AB1");
  assert.equal(remit.parseRemit("zzz"), undefined);
  assert.equal(remit.isRemitValid(132), true);
  assert.equal(remit.isRemitValid(133), false);
  assert.equal(remit.clampRemit(1000), 132);
  assert.equal(remit.describeRemit("RE01"), "returnable remit session");
  assert.match(remit.describeRemit("nope"), /^unknown remit code/);
});

test("billing/audit-log", () => {
  assert.equal(auditLog.formatAuditLog(" ab1 "), "AUD-AB1");
  assert.equal(auditLog.parseAuditLog("AUD-AB1"), "AB1");
  assert.equal(auditLog.parseAuditLog("zzz"), undefined);
  assert.equal(auditLog.isAuditLogValid(133), true);
  assert.equal(auditLog.isAuditLogValid(134), false);
  assert.equal(auditLog.clampAuditLog(1000), 133);
  assert.equal(auditLog.auditLogWeight("b"), 35);
  assert.equal(auditLog.auditLogWeight("z"), 0);
  assert.equal(auditLog.totalAuditLogWeight(["a", "c", "z"]), 70);
  assert.equal(auditLog.describeAuditLog("AU01"), "perishable audit-log plan");
  assert.match(auditLog.describeAuditLog("nope"), /^unknown audit-log code/);
});

test("billing/escrow", () => {
  assert.equal(escrow.isEscrowValid(134), true);
  assert.equal(escrow.isEscrowValid(135), false);
  assert.equal(escrow.clampEscrow(1000), 134);
  assert.equal(escrow.escrowWeight("b"), 36);
  assert.equal(escrow.escrowWeight("z"), 0);
  assert.equal(escrow.totalEscrowWeight(["a", "c", "z"]), 72);
  assert.equal(escrow.escrowScale(10), 60);
  assert.equal(escrow.escrowShare(1, 4), 25);
  assert.equal(escrow.escrowShare(1, 0), 0);
  assert.equal(escrow.describeEscrow("ES01"), "regulated escrow entry");
  assert.match(escrow.describeEscrow("nope"), /^unknown escrow code/);
});

test("billing/float", () => {
  assert.equal(float.floatWeight("b"), 37);
  assert.equal(float.floatWeight("z"), 0);
  assert.equal(float.totalFloatWeight(["a", "c", "z"]), 74);
  assert.equal(float.floatScale(10), 20);
  assert.equal(float.floatShare(1, 4), 25);
  assert.equal(float.floatShare(1, 0), 0);
  assert.equal(float.floatLabel(1), "1 float");
  assert.equal(float.floatLabel(3), "3 floats");
  assert.equal(float.floatSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(float.floatSummary({}), "none");
  assert.equal(float.describeFloat("FL01"), "oversized float window");
  assert.match(float.describeFloat("nope"), /^unknown float code/);
});

test("billing/hold", () => {
  assert.equal(hold.holdScale(10), 30);
  assert.equal(hold.holdShare(1, 4), 25);
  assert.equal(hold.holdShare(1, 0), 0);
  assert.equal(hold.holdLabel(1), "1 hold");
  assert.equal(hold.holdLabel(3), "3 holds");
  assert.equal(hold.holdSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(hold.holdSummary({}), "none");
  assert.equal(hold.formatHold(" ab1 "), "HOL-AB1");
  assert.equal(hold.parseHold("HOL-AB1"), "AB1");
  assert.equal(hold.parseHold("zzz"), undefined);
  assert.equal(hold.describeHold("HO01"), "premium hold check");
  assert.match(hold.describeHold("nope"), /^unknown hold code/);
});

test("billing/release", () => {
  assert.equal(release.releaseLabel(1), "1 release");
  assert.equal(release.releaseLabel(3), "3 releases");
  assert.equal(release.releaseSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(release.releaseSummary({}), "none");
  assert.equal(release.formatRelease(" ab1 "), "REL-AB1");
  assert.equal(release.parseRelease("REL-AB1"), "AB1");
  assert.equal(release.parseRelease("zzz"), undefined);
  assert.equal(release.isReleaseValid(137), true);
  assert.equal(release.isReleaseValid(138), false);
  assert.equal(release.clampRelease(1000), 137);
  assert.equal(release.describeRelease("RE01"), "discounted release slot");
  assert.match(release.describeRelease("nope"), /^unknown release code/);
});

test("billing/adjust", () => {
  assert.equal(adjust.formatAdjust(" ab1 "), "ADJ-AB1");
  assert.equal(adjust.parseAdjust("ADJ-AB1"), "AB1");
  assert.equal(adjust.parseAdjust("zzz"), undefined);
  assert.equal(adjust.isAdjustValid(138), true);
  assert.equal(adjust.isAdjustValid(139), false);
  assert.equal(adjust.clampAdjust(1000), 138);
  assert.equal(adjust.adjustWeight("b"), 40);
  assert.equal(adjust.adjustWeight("z"), 0);
  assert.equal(adjust.totalAdjustWeight(["a", "c", "z"]), 80);
  assert.equal(adjust.describeAdjust("AD01"), "limited adjust group");
  assert.match(adjust.describeAdjust("nope"), /^unknown adjust code/);
});
