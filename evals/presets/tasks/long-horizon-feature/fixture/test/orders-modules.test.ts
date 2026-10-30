import assert from "node:assert/strict";
import { test } from "node:test";
import * as cart from "../src/orders/cart.ts";
import * as checkout from "../src/orders/checkout.ts";
import * as coupon from "../src/orders/coupon.ts";
import * as voucher from "../src/orders/voucher.ts";
import * as gift from "../src/orders/gift.ts";
import * as wishlist from "../src/orders/wishlist.ts";
import * as address from "../src/orders/address.ts";
import * as carrier from "../src/orders/carrier.ts";
import * as parcel from "../src/orders/parcel.ts";
import * as tracking from "../src/orders/tracking.ts";
import * as delivery from "../src/orders/delivery.ts";
import * as pickup from "../src/orders/pickup.ts";
import * as locker from "../src/orders/locker.ts";
import * as invoice from "../src/orders/invoice.ts";
import * as receipt from "../src/orders/receipt.ts";
import * as refund from "../src/orders/refund.ts";
import * as exchange from "../src/orders/exchange.ts";
import * as backorder from "../src/orders/backorder.ts";
import * as preorder from "../src/orders/preorder.ts";
import * as bundle from "../src/orders/bundle.ts";
import * as subscription from "../src/orders/subscription.ts";
import * as tax from "../src/orders/tax.ts";
import * as duty from "../src/orders/duty.ts";
import * as tip from "../src/orders/tip.ts";
import * as fee from "../src/orders/fee.ts";
import * as surcharge from "../src/orders/surcharge.ts";
import * as rounding from "../src/orders/rounding.ts";
import * as currency from "../src/orders/currency.ts";
import * as channel from "../src/orders/channel.ts";
import * as source from "../src/orders/source.ts";
import * as campaign from "../src/orders/campaign.ts";
import * as referral from "../src/orders/referral.ts";

test("orders/cart", () => {
  assert.equal(cart.isCartValid(100), true);
  assert.equal(cart.isCartValid(101), false);
});

test("orders/checkout", () => {
  assert.equal(checkout.checkoutWeight("b"), 3);
  assert.equal(checkout.checkoutWeight("z"), 0);
});

test("orders/coupon", () => {
  assert.equal(coupon.couponScale(10), 40);
});

test("orders/voucher", () => {
  assert.equal(voucher.voucherLabel(1), "1 voucher");
  assert.equal(voucher.voucherLabel(3), "3 vouchers");
});

test("orders/gift", () => {
  assert.equal(gift.formatGift(" ab1 "), "GIF-AB1");
});

test("orders/wishlist", () => {
  assert.equal(wishlist.isWishlistValid(105), true);
  assert.equal(wishlist.isWishlistValid(106), false);
});

test("orders/address", () => {
  assert.equal(address.addressWeight("b"), 8);
  assert.equal(address.addressWeight("z"), 0);
});

test("orders/carrier", () => {
  assert.equal(carrier.carrierScale(10), 40);
});

test("orders/parcel", () => {
  assert.equal(parcel.parcelLabel(1), "1 parcel");
  assert.equal(parcel.parcelLabel(3), "3 parcels");
});

test("orders/tracking", () => {
  assert.equal(tracking.formatTracking(" ab1 "), "TRA-AB1");
});

test("orders/delivery", () => {
  assert.equal(delivery.isDeliveryValid(110), true);
  assert.equal(delivery.isDeliveryValid(111), false);
});

test("orders/pickup", () => {
  assert.equal(pickup.pickupWeight("b"), 13);
  assert.equal(pickup.pickupWeight("z"), 0);
});

test("orders/locker", () => {
  assert.equal(locker.lockerScale(10), 40);
});

test("orders/invoice", () => {
  assert.equal(invoice.invoiceLabel(1), "1 invoice");
  assert.equal(invoice.invoiceLabel(3), "3 invoices");
});

test("orders/receipt", () => {
  assert.equal(receipt.formatReceipt(" ab1 "), "REC-AB1");
});

test("orders/refund", () => {
  assert.equal(refund.isRefundValid(115), true);
  assert.equal(refund.isRefundValid(116), false);
});

test("orders/exchange", () => {
  assert.equal(exchange.exchangeWeight("b"), 18);
  assert.equal(exchange.exchangeWeight("z"), 0);
});

test("orders/backorder", () => {
  assert.equal(backorder.backorderScale(10), 40);
});

test("orders/preorder", () => {
  assert.equal(preorder.preorderLabel(1), "1 preorder");
  assert.equal(preorder.preorderLabel(3), "3 preorders");
});

test("orders/bundle", () => {
  assert.equal(bundle.formatBundle(" ab1 "), "BUN-AB1");
});

test("orders/subscription", () => {
  assert.equal(subscription.isSubscriptionValid(120), true);
  assert.equal(subscription.isSubscriptionValid(121), false);
});

test("orders/tax", () => {
  assert.equal(tax.taxWeight("b"), 23);
  assert.equal(tax.taxWeight("z"), 0);
});

test("orders/duty", () => {
  assert.equal(duty.dutyScale(10), 40);
});

test("orders/tip", () => {
  assert.equal(tip.tipLabel(1), "1 tip");
  assert.equal(tip.tipLabel(3), "3 tips");
});

test("orders/fee", () => {
  assert.equal(fee.formatFee(" ab1 "), "FEE-AB1");
});

test("orders/surcharge", () => {
  assert.equal(surcharge.isSurchargeValid(125), true);
  assert.equal(surcharge.isSurchargeValid(126), false);
});

test("orders/rounding", () => {
  assert.equal(rounding.roundingWeight("b"), 28);
  assert.equal(rounding.roundingWeight("z"), 0);
});

test("orders/currency", () => {
  assert.equal(currency.currencyScale(10), 40);
});

test("orders/channel", () => {
  assert.equal(channel.channelLabel(1), "1 channel");
  assert.equal(channel.channelLabel(3), "3 channels");
});

test("orders/source", () => {
  assert.equal(source.formatSource(" ab1 "), "SOU-AB1");
});

test("orders/campaign", () => {
  assert.equal(campaign.isCampaignValid(130), true);
  assert.equal(campaign.isCampaignValid(131), false);
});

test("orders/referral", () => {
  assert.equal(referral.referralWeight("b"), 33);
  assert.equal(referral.referralWeight("z"), 0);
});
