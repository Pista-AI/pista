import assert from "node:assert/strict";
import { test } from "node:test";
import * as method from "../src/payments/method.ts";
import * as gateway from "../src/payments/gateway.ts";
import * as token from "../src/payments/token.ts";
import * as wallet from "../src/payments/wallet.ts";
import * as voucher from "../src/payments/voucher.ts";
import * as capture from "../src/payments/capture.ts";
import * as settle from "../src/payments/settle.ts";
import * as payout from "../src/payments/payout.ts";
import * as fee from "../src/payments/fee.ts";
import * as currency from "../src/payments/currency.ts";
import * as mandate from "../src/payments/mandate.ts";
import * as receipt from "../src/payments/receipt.ts";
import * as terminal from "../src/payments/terminal.ts";

test("payments/method", () => {
  assert.equal(method.methodScale(10), 20);
});

test("payments/gateway", () => {
  assert.equal(gateway.gatewayLabel(1), "1 gateway");
  assert.equal(gateway.gatewayLabel(3), "3 gateways");
});

test("payments/token", () => {
  assert.equal(token.formatToken(" ab1 "), "TOK-AB1");
});

test("payments/wallet", () => {
  assert.equal(wallet.isWalletValid(103), true);
  assert.equal(wallet.isWalletValid(104), false);
});

test("payments/voucher", () => {
  assert.equal(voucher.voucherWeight("b"), 6);
  assert.equal(voucher.voucherWeight("z"), 0);
});

test("payments/capture", () => {
  assert.equal(capture.captureScale(10), 20);
});

test("payments/settle", () => {
  assert.equal(settle.settleLabel(1), "1 settle");
  assert.equal(settle.settleLabel(3), "3 settles");
});

test("payments/payout", () => {
  assert.equal(payout.formatPayout(" ab1 "), "PAY-AB1");
});

test("payments/fee", () => {
  assert.equal(fee.isFeeValid(108), true);
  assert.equal(fee.isFeeValid(109), false);
});

test("payments/currency", () => {
  assert.equal(currency.currencyWeight("b"), 11);
  assert.equal(currency.currencyWeight("z"), 0);
});

test("payments/mandate", () => {
  assert.equal(mandate.mandateScale(10), 20);
});

test("payments/receipt", () => {
  assert.equal(receipt.receiptLabel(1), "1 receipt");
  assert.equal(receipt.receiptLabel(3), "3 receipts");
});

test("payments/terminal", () => {
  assert.equal(terminal.formatTerminal(" ab1 "), "TER-AB1");
});
