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

test("billing/ledger", () => {
  assert.equal(ledger.ledgerWeight("b"), 2);
  assert.equal(ledger.ledgerWeight("z"), 0);
});

test("billing/account", () => {
  assert.equal(account.accountScale(10), 30);
});

test("billing/balance", () => {
  assert.equal(balance.balanceLabel(1), "1 balance");
  assert.equal(balance.balanceLabel(3), "3 balances");
});

test("billing/payout", () => {
  assert.equal(payout.formatPayout(" ab1 "), "PAY-AB1");
});

test("billing/charge", () => {
  assert.equal(charge.isChargeValid(104), true);
  assert.equal(charge.isChargeValid(105), false);
});

test("billing/capture", () => {
  assert.equal(capture.captureWeight("b"), 7);
  assert.equal(capture.captureWeight("z"), 0);
});

test("billing/authorize", () => {
  assert.equal(authorize.authorizeScale(10), 30);
});

test("billing/dispute", () => {
  assert.equal(dispute.disputeLabel(1), "1 dispute");
  assert.equal(dispute.disputeLabel(3), "3 disputes");
});

test("billing/chargeback", () => {
  assert.equal(chargeback.formatChargeback(" ab1 "), "CHA-AB1");
});

test("billing/settlement", () => {
  assert.equal(settlement.isSettlementValid(109), true);
  assert.equal(settlement.isSettlementValid(110), false);
});

test("billing/fee", () => {
  assert.equal(fee.feeWeight("b"), 12);
  assert.equal(fee.feeWeight("z"), 0);
});

test("billing/interest", () => {
  assert.equal(interest.interestScale(10), 30);
});

test("billing/credit", () => {
  assert.equal(credit.creditLabel(1), "1 credit");
  assert.equal(credit.creditLabel(3), "3 credits");
});

test("billing/debit", () => {
  assert.equal(debit.formatDebit(" ab1 "), "DEB-AB1");
});

test("billing/statement", () => {
  assert.equal(statement.isStatementValid(114), true);
  assert.equal(statement.isStatementValid(115), false);
});

test("billing/reminder", () => {
  assert.equal(reminder.reminderWeight("b"), 17);
  assert.equal(reminder.reminderWeight("z"), 0);
});

test("billing/dunning", () => {
  assert.equal(dunning.dunningScale(10), 30);
});

test("billing/writeoff", () => {
  assert.equal(writeoff.writeoffLabel(1), "1 writeoff");
  assert.equal(writeoff.writeoffLabel(3), "3 writeoffs");
});

test("billing/proration", () => {
  assert.equal(proration.formatProration(" ab1 "), "PRO-AB1");
});

test("billing/plan", () => {
  assert.equal(plan.isPlanValid(119), true);
  assert.equal(plan.isPlanValid(120), false);
});

test("billing/tier", () => {
  assert.equal(tier.tierWeight("b"), 22);
  assert.equal(tier.tierWeight("z"), 0);
});

test("billing/trial", () => {
  assert.equal(trial.trialScale(10), 30);
});

test("billing/renewal", () => {
  assert.equal(renewal.renewalLabel(1), "1 renewal");
  assert.equal(renewal.renewalLabel(3), "3 renewals");
});

test("billing/cancel", () => {
  assert.equal(cancel.formatCancel(" ab1 "), "CAN-AB1");
});

test("billing/pause", () => {
  assert.equal(pause.isPauseValid(124), true);
  assert.equal(pause.isPauseValid(125), false);
});

test("billing/reactivate", () => {
  assert.equal(reactivate.reactivateWeight("b"), 27);
  assert.equal(reactivate.reactivateWeight("z"), 0);
});

test("billing/mandate", () => {
  assert.equal(mandate.mandateScale(10), 30);
});

test("billing/token", () => {
  assert.equal(token.tokenLabel(1), "1 token");
  assert.equal(token.tokenLabel(3), "3 tokens");
});

test("billing/vault", () => {
  assert.equal(vault.formatVault(" ab1 "), "VAU-AB1");
});

test("billing/risk", () => {
  assert.equal(risk.isRiskValid(129), true);
  assert.equal(risk.isRiskValid(130), false);
});

test("billing/fraud", () => {
  assert.equal(fraud.fraudWeight("b"), 32);
  assert.equal(fraud.fraudWeight("z"), 0);
});
