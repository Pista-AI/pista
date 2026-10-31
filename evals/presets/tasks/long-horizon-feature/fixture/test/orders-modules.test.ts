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
import * as basket from "../src/orders/basket.ts";
import * as promo from "../src/orders/promo.ts";
import * as upsell from "../src/orders/upsell.ts";
import * as fraudcheck from "../src/orders/fraudcheck.ts";
import * as handling from "../src/orders/handling.ts";
import * as labelPrint from "../src/orders/label-print.ts";
import * as gifting from "../src/orders/gifting.ts";
import * as note from "../src/orders/note.ts";

test("orders/cart", () => {
  assert.equal(cart.isCartValid(100), true);
  assert.equal(cart.isCartValid(101), false);
  assert.equal(cart.clampCart(1000), 100);
  assert.equal(cart.cartWeight("b"), 2);
  assert.equal(cart.cartWeight("z"), 0);
  assert.equal(cart.totalCartWeight(["a", "c", "z"]), 4);
  assert.equal(cart.cartScale(10), 20);
  assert.equal(cart.cartShare(1, 4), 25);
  assert.equal(cart.cartShare(1, 0), 0);
  assert.equal(cart.describeCart("CA01"), "standard cart request");
  assert.match(cart.describeCart("nope"), /^unknown cart code/);
});

test("orders/checkout", () => {
  assert.equal(checkout.checkoutWeight("b"), 3);
  assert.equal(checkout.checkoutWeight("z"), 0);
  assert.equal(checkout.totalCheckoutWeight(["a", "c", "z"]), 6);
  assert.equal(checkout.checkoutScale(10), 30);
  assert.equal(checkout.checkoutShare(1, 4), 25);
  assert.equal(checkout.checkoutShare(1, 0), 0);
  assert.equal(checkout.checkoutLabel(1), "1 checkout");
  assert.equal(checkout.checkoutLabel(3), "3 checkouts");
  assert.equal(checkout.checkoutSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(checkout.checkoutSummary({}), "none");
  assert.equal(checkout.describeCheckout("CH01"), "express checkout batch");
  assert.match(checkout.describeCheckout("nope"), /^unknown checkout code/);
});

test("orders/coupon", () => {
  assert.equal(coupon.couponScale(10), 40);
  assert.equal(coupon.couponShare(1, 4), 25);
  assert.equal(coupon.couponShare(1, 0), 0);
  assert.equal(coupon.couponLabel(1), "1 coupon");
  assert.equal(coupon.couponLabel(3), "3 coupons");
  assert.equal(coupon.couponSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(coupon.couponSummary({}), "none");
  assert.equal(coupon.formatCoupon(" ab1 "), "COU-AB1");
  assert.equal(coupon.parseCoupon("COU-AB1"), "AB1");
  assert.equal(coupon.parseCoupon("zzz"), undefined);
  assert.equal(coupon.describeCoupon("CO01"), "fragile coupon policy");
  assert.match(coupon.describeCoupon("nope"), /^unknown coupon code/);
});

test("orders/voucher", () => {
  assert.equal(voucher.voucherLabel(1), "1 voucher");
  assert.equal(voucher.voucherLabel(3), "3 vouchers");
  assert.equal(voucher.voucherSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(voucher.voucherSummary({}), "none");
  assert.equal(voucher.formatVoucher(" ab1 "), "VOU-AB1");
  assert.equal(voucher.parseVoucher("VOU-AB1"), "AB1");
  assert.equal(voucher.parseVoucher("zzz"), undefined);
  assert.equal(voucher.isVoucherValid(103), true);
  assert.equal(voucher.isVoucherValid(104), false);
  assert.equal(voucher.clampVoucher(1000), 103);
  assert.equal(voucher.describeVoucher("VO01"), "bulky voucher ticket");
  assert.match(voucher.describeVoucher("nope"), /^unknown voucher code/);
});

test("orders/gift", () => {
  assert.equal(gift.formatGift(" ab1 "), "GIF-AB1");
  assert.equal(gift.parseGift("GIF-AB1"), "AB1");
  assert.equal(gift.parseGift("zzz"), undefined);
  assert.equal(gift.isGiftValid(104), true);
  assert.equal(gift.isGiftValid(105), false);
  assert.equal(gift.clampGift(1000), 104);
  assert.equal(gift.giftWeight("b"), 6);
  assert.equal(gift.giftWeight("z"), 0);
  assert.equal(gift.totalGiftWeight(["a", "c", "z"]), 12);
  assert.equal(gift.describeGift("GI01"), "seasonal gift lane");
  assert.match(gift.describeGift("nope"), /^unknown gift code/);
});

test("orders/wishlist", () => {
  assert.equal(wishlist.isWishlistValid(105), true);
  assert.equal(wishlist.isWishlistValid(106), false);
  assert.equal(wishlist.clampWishlist(1000), 105);
  assert.equal(wishlist.wishlistWeight("b"), 7);
  assert.equal(wishlist.wishlistWeight("z"), 0);
  assert.equal(wishlist.totalWishlistWeight(["a", "c", "z"]), 14);
  assert.equal(wishlist.wishlistScale(10), 20);
  assert.equal(wishlist.wishlistShare(1, 4), 25);
  assert.equal(wishlist.wishlistShare(1, 0), 0);
  assert.equal(wishlist.describeWishlist("WI01"), "returnable wishlist profile");
  assert.match(wishlist.describeWishlist("nope"), /^unknown wishlist code/);
});

test("orders/address", () => {
  assert.equal(address.addressWeight("b"), 8);
  assert.equal(address.addressWeight("z"), 0);
  assert.equal(address.totalAddressWeight(["a", "c", "z"]), 16);
  assert.equal(address.addressScale(10), 30);
  assert.equal(address.addressShare(1, 4), 25);
  assert.equal(address.addressShare(1, 0), 0);
  assert.equal(address.addressLabel(1), "1 address");
  assert.equal(address.addressLabel(3), "3 addresss");
  assert.equal(address.addressSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(address.addressSummary({}), "none");
  assert.equal(address.describeAddress("AD01"), "perishable address quota");
  assert.match(address.describeAddress("nope"), /^unknown address code/);
});

test("orders/carrier", () => {
  assert.equal(carrier.carrierScale(10), 40);
  assert.equal(carrier.carrierShare(1, 4), 25);
  assert.equal(carrier.carrierShare(1, 0), 0);
  assert.equal(carrier.carrierLabel(1), "1 carrier");
  assert.equal(carrier.carrierLabel(3), "3 carriers");
  assert.equal(carrier.carrierSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(carrier.carrierSummary({}), "none");
  assert.equal(carrier.formatCarrier(" ab1 "), "CAR-AB1");
  assert.equal(carrier.parseCarrier("CAR-AB1"), "AB1");
  assert.equal(carrier.parseCarrier("zzz"), undefined);
  assert.equal(carrier.describeCarrier("CA01"), "regulated carrier session");
  assert.match(carrier.describeCarrier("nope"), /^unknown carrier code/);
});

test("orders/parcel", () => {
  assert.equal(parcel.parcelLabel(1), "1 parcel");
  assert.equal(parcel.parcelLabel(3), "3 parcels");
  assert.equal(parcel.parcelSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(parcel.parcelSummary({}), "none");
  assert.equal(parcel.formatParcel(" ab1 "), "PAR-AB1");
  assert.equal(parcel.parseParcel("PAR-AB1"), "AB1");
  assert.equal(parcel.parseParcel("zzz"), undefined);
  assert.equal(parcel.isParcelValid(108), true);
  assert.equal(parcel.isParcelValid(109), false);
  assert.equal(parcel.clampParcel(1000), 108);
  assert.equal(parcel.describeParcel("PA01"), "oversized parcel plan");
  assert.match(parcel.describeParcel("nope"), /^unknown parcel code/);
});

test("orders/tracking", () => {
  assert.equal(tracking.formatTracking(" ab1 "), "TRA-AB1");
  assert.equal(tracking.parseTracking("TRA-AB1"), "AB1");
  assert.equal(tracking.parseTracking("zzz"), undefined);
  assert.equal(tracking.isTrackingValid(109), true);
  assert.equal(tracking.isTrackingValid(110), false);
  assert.equal(tracking.clampTracking(1000), 109);
  assert.equal(tracking.trackingWeight("b"), 11);
  assert.equal(tracking.trackingWeight("z"), 0);
  assert.equal(tracking.totalTrackingWeight(["a", "c", "z"]), 22);
  assert.equal(tracking.describeTracking("TR01"), "premium tracking entry");
  assert.match(tracking.describeTracking("nope"), /^unknown tracking code/);
});

test("orders/delivery", () => {
  assert.equal(delivery.isDeliveryValid(110), true);
  assert.equal(delivery.isDeliveryValid(111), false);
  assert.equal(delivery.clampDelivery(1000), 110);
  assert.equal(delivery.deliveryWeight("b"), 12);
  assert.equal(delivery.deliveryWeight("z"), 0);
  assert.equal(delivery.totalDeliveryWeight(["a", "c", "z"]), 24);
  assert.equal(delivery.deliveryScale(10), 20);
  assert.equal(delivery.deliveryShare(1, 4), 25);
  assert.equal(delivery.deliveryShare(1, 0), 0);
  assert.equal(delivery.describeDelivery("DE01"), "discounted delivery window");
  assert.match(delivery.describeDelivery("nope"), /^unknown delivery code/);
});

test("orders/pickup", () => {
  assert.equal(pickup.pickupWeight("b"), 13);
  assert.equal(pickup.pickupWeight("z"), 0);
  assert.equal(pickup.totalPickupWeight(["a", "c", "z"]), 26);
  assert.equal(pickup.pickupScale(10), 30);
  assert.equal(pickup.pickupShare(1, 4), 25);
  assert.equal(pickup.pickupShare(1, 0), 0);
  assert.equal(pickup.pickupLabel(1), "1 pickup");
  assert.equal(pickup.pickupLabel(3), "3 pickups");
  assert.equal(pickup.pickupSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(pickup.pickupSummary({}), "none");
  assert.equal(pickup.describePickup("PI01"), "limited pickup check");
  assert.match(pickup.describePickup("nope"), /^unknown pickup code/);
});

test("orders/locker", () => {
  assert.equal(locker.lockerScale(10), 40);
  assert.equal(locker.lockerShare(1, 4), 25);
  assert.equal(locker.lockerShare(1, 0), 0);
  assert.equal(locker.lockerLabel(1), "1 locker");
  assert.equal(locker.lockerLabel(3), "3 lockers");
  assert.equal(locker.lockerSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(locker.lockerSummary({}), "none");
  assert.equal(locker.formatLocker(" ab1 "), "LOC-AB1");
  assert.equal(locker.parseLocker("LOC-AB1"), "AB1");
  assert.equal(locker.parseLocker("zzz"), undefined);
  assert.equal(locker.describeLocker("LO01"), "archived locker slot");
  assert.match(locker.describeLocker("nope"), /^unknown locker code/);
});

test("orders/invoice", () => {
  assert.equal(invoice.invoiceLabel(1), "1 invoice");
  assert.equal(invoice.invoiceLabel(3), "3 invoices");
  assert.equal(invoice.invoiceSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(invoice.invoiceSummary({}), "none");
  assert.equal(invoice.formatInvoice(" ab1 "), "INV-AB1");
  assert.equal(invoice.parseInvoice("INV-AB1"), "AB1");
  assert.equal(invoice.parseInvoice("zzz"), undefined);
  assert.equal(invoice.isInvoiceValid(113), true);
  assert.equal(invoice.isInvoiceValid(114), false);
  assert.equal(invoice.clampInvoice(1000), 113);
  assert.equal(invoice.describeInvoice("IN01"), "pending invoice group");
  assert.match(invoice.describeInvoice("nope"), /^unknown invoice code/);
});

test("orders/receipt", () => {
  assert.equal(receipt.formatReceipt(" ab1 "), "REC-AB1");
  assert.equal(receipt.parseReceipt("REC-AB1"), "AB1");
  assert.equal(receipt.parseReceipt("zzz"), undefined);
  assert.equal(receipt.isReceiptValid(114), true);
  assert.equal(receipt.isReceiptValid(115), false);
  assert.equal(receipt.clampReceipt(1000), 114);
  assert.equal(receipt.receiptWeight("b"), 16);
  assert.equal(receipt.receiptWeight("z"), 0);
  assert.equal(receipt.totalReceiptWeight(["a", "c", "z"]), 32);
  assert.equal(receipt.describeReceipt("RE01"), "verified receipt cap");
  assert.match(receipt.describeReceipt("nope"), /^unknown receipt code/);
});

test("orders/refund", () => {
  assert.equal(refund.isRefundValid(115), true);
  assert.equal(refund.isRefundValid(116), false);
  assert.equal(refund.clampRefund(1000), 115);
  assert.equal(refund.refundWeight("b"), 17);
  assert.equal(refund.refundWeight("z"), 0);
  assert.equal(refund.totalRefundWeight(["a", "c", "z"]), 34);
  assert.equal(refund.refundScale(10), 20);
  assert.equal(refund.refundShare(1, 4), 25);
  assert.equal(refund.refundShare(1, 0), 0);
  assert.equal(refund.describeRefund("RE01"), "flagged refund ledger");
  assert.match(refund.describeRefund("nope"), /^unknown refund code/);
});

test("orders/exchange", () => {
  assert.equal(exchange.exchangeWeight("b"), 18);
  assert.equal(exchange.exchangeWeight("z"), 0);
  assert.equal(exchange.totalExchangeWeight(["a", "c", "z"]), 36);
  assert.equal(exchange.exchangeScale(10), 30);
  assert.equal(exchange.exchangeShare(1, 4), 25);
  assert.equal(exchange.exchangeShare(1, 0), 0);
  assert.equal(exchange.exchangeLabel(1), "1 exchange");
  assert.equal(exchange.exchangeLabel(3), "3 exchanges");
  assert.equal(exchange.exchangeSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(exchange.exchangeSummary({}), "none");
  assert.equal(exchange.describeExchange("EX01"), "manual exchange notice");
  assert.match(exchange.describeExchange("nope"), /^unknown exchange code/);
});

test("orders/backorder", () => {
  assert.equal(backorder.backorderScale(10), 40);
  assert.equal(backorder.backorderShare(1, 4), 25);
  assert.equal(backorder.backorderShare(1, 0), 0);
  assert.equal(backorder.backorderLabel(1), "1 backorder");
  assert.equal(backorder.backorderLabel(3), "3 backorders");
  assert.equal(backorder.backorderSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(backorder.backorderSummary({}), "none");
  assert.equal(backorder.formatBackorder(" ab1 "), "BAC-AB1");
  assert.equal(backorder.parseBackorder("BAC-AB1"), "AB1");
  assert.equal(backorder.parseBackorder("zzz"), undefined);
  assert.equal(backorder.describeBackorder("BA01"), "automatic backorder record");
  assert.match(backorder.describeBackorder("nope"), /^unknown backorder code/);
});

test("orders/preorder", () => {
  assert.equal(preorder.preorderLabel(1), "1 preorder");
  assert.equal(preorder.preorderLabel(3), "3 preorders");
  assert.equal(preorder.preorderSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(preorder.preorderSummary({}), "none");
  assert.equal(preorder.formatPreorder(" ab1 "), "PRE-AB1");
  assert.equal(preorder.parsePreorder("PRE-AB1"), "AB1");
  assert.equal(preorder.parsePreorder("zzz"), undefined);
  assert.equal(preorder.isPreorderValid(118), true);
  assert.equal(preorder.isPreorderValid(119), false);
  assert.equal(preorder.clampPreorder(1000), 118);
  assert.equal(preorder.describePreorder("PR01"), "partial preorder route");
  assert.match(preorder.describePreorder("nope"), /^unknown preorder code/);
});

test("orders/bundle", () => {
  assert.equal(bundle.formatBundle(" ab1 "), "BUN-AB1");
  assert.equal(bundle.parseBundle("BUN-AB1"), "AB1");
  assert.equal(bundle.parseBundle("zzz"), undefined);
  assert.equal(bundle.isBundleValid(119), true);
  assert.equal(bundle.isBundleValid(120), false);
  assert.equal(bundle.clampBundle(1000), 119);
  assert.equal(bundle.bundleWeight("b"), 21);
  assert.equal(bundle.bundleWeight("z"), 0);
  assert.equal(bundle.totalBundleWeight(["a", "c", "z"]), 42);
  assert.equal(bundle.describeBundle("BU01"), "primary bundle rule");
  assert.match(bundle.describeBundle("nope"), /^unknown bundle code/);
});

test("orders/subscription", () => {
  assert.equal(subscription.isSubscriptionValid(120), true);
  assert.equal(subscription.isSubscriptionValid(121), false);
  assert.equal(subscription.clampSubscription(1000), 120);
  assert.equal(subscription.subscriptionWeight("b"), 22);
  assert.equal(subscription.subscriptionWeight("z"), 0);
  assert.equal(subscription.totalSubscriptionWeight(["a", "c", "z"]), 44);
  assert.equal(subscription.subscriptionScale(10), 20);
  assert.equal(subscription.subscriptionShare(1, 4), 25);
  assert.equal(subscription.subscriptionShare(1, 0), 0);
  assert.equal(subscription.describeSubscription("SU01"), "secondary subscription queue");
  assert.match(subscription.describeSubscription("nope"), /^unknown subscription code/);
});

test("orders/tax", () => {
  assert.equal(tax.taxWeight("b"), 23);
  assert.equal(tax.taxWeight("z"), 0);
  assert.equal(tax.totalTaxWeight(["a", "c", "z"]), 46);
  assert.equal(tax.taxScale(10), 30);
  assert.equal(tax.taxShare(1, 4), 25);
  assert.equal(tax.taxShare(1, 0), 0);
  assert.equal(tax.taxLabel(1), "1 tax");
  assert.equal(tax.taxLabel(3), "3 taxs");
  assert.equal(tax.taxSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(tax.taxSummary({}), "none");
  assert.equal(tax.describeTax("TA01"), "legacy tax tier");
  assert.match(tax.describeTax("nope"), /^unknown tax code/);
});

test("orders/duty", () => {
  assert.equal(duty.dutyScale(10), 40);
  assert.equal(duty.dutyShare(1, 4), 25);
  assert.equal(duty.dutyShare(1, 0), 0);
  assert.equal(duty.dutyLabel(1), "1 duty");
  assert.equal(duty.dutyLabel(3), "3 dutys");
  assert.equal(duty.dutySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(duty.dutySummary({}), "none");
  assert.equal(duty.formatDuty(" ab1 "), "DUT-AB1");
  assert.equal(duty.parseDuty("DUT-AB1"), "AB1");
  assert.equal(duty.parseDuty("zzz"), undefined);
  assert.equal(duty.describeDuty("DU01"), "trial duty rate");
  assert.match(duty.describeDuty("nope"), /^unknown duty code/);
});

test("orders/tip", () => {
  assert.equal(tip.tipLabel(1), "1 tip");
  assert.equal(tip.tipLabel(3), "3 tips");
  assert.equal(tip.tipSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(tip.tipSummary({}), "none");
  assert.equal(tip.formatTip(" ab1 "), "TIP-AB1");
  assert.equal(tip.parseTip("TIP-AB1"), "AB1");
  assert.equal(tip.parseTip("zzz"), undefined);
  assert.equal(tip.isTipValid(123), true);
  assert.equal(tip.isTipValid(124), false);
  assert.equal(tip.clampTip(1000), 123);
  assert.equal(tip.describeTip("TI01"), "internal tip cycle");
  assert.match(tip.describeTip("nope"), /^unknown tip code/);
});

test("orders/fee", () => {
  assert.equal(fee.formatFee(" ab1 "), "FEE-AB1");
  assert.equal(fee.parseFee("FEE-AB1"), "AB1");
  assert.equal(fee.parseFee("zzz"), undefined);
  assert.equal(fee.isFeeValid(124), true);
  assert.equal(fee.isFeeValid(125), false);
  assert.equal(fee.clampFee(1000), 124);
  assert.equal(fee.feeWeight("b"), 26);
  assert.equal(fee.feeWeight("z"), 0);
  assert.equal(fee.totalFeeWeight(["a", "c", "z"]), 52);
  assert.equal(fee.describeFee("FE01"), "external fee contact");
  assert.match(fee.describeFee("nope"), /^unknown fee code/);
});

test("orders/surcharge", () => {
  assert.equal(surcharge.isSurchargeValid(125), true);
  assert.equal(surcharge.isSurchargeValid(126), false);
  assert.equal(surcharge.clampSurcharge(1000), 125);
  assert.equal(surcharge.surchargeWeight("b"), 27);
  assert.equal(surcharge.surchargeWeight("z"), 0);
  assert.equal(surcharge.totalSurchargeWeight(["a", "c", "z"]), 54);
  assert.equal(surcharge.surchargeScale(10), 20);
  assert.equal(surcharge.surchargeShare(1, 4), 25);
  assert.equal(surcharge.surchargeShare(1, 0), 0);
  assert.equal(surcharge.describeSurcharge("SU01"), "priority surcharge request");
  assert.match(surcharge.describeSurcharge("nope"), /^unknown surcharge code/);
});

test("orders/rounding", () => {
  assert.equal(rounding.roundingWeight("b"), 28);
  assert.equal(rounding.roundingWeight("z"), 0);
  assert.equal(rounding.totalRoundingWeight(["a", "c", "z"]), 56);
  assert.equal(rounding.roundingScale(10), 30);
  assert.equal(rounding.roundingShare(1, 4), 25);
  assert.equal(rounding.roundingShare(1, 0), 0);
  assert.equal(rounding.roundingLabel(1), "1 rounding");
  assert.equal(rounding.roundingLabel(3), "3 roundings");
  assert.equal(rounding.roundingSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(rounding.roundingSummary({}), "none");
  assert.equal(rounding.describeRounding("RO01"), "deferred rounding batch");
  assert.match(rounding.describeRounding("nope"), /^unknown rounding code/);
});

test("orders/currency", () => {
  assert.equal(currency.currencyScale(10), 40);
  assert.equal(currency.currencyShare(1, 4), 25);
  assert.equal(currency.currencyShare(1, 0), 0);
  assert.equal(currency.currencyLabel(1), "1 currency");
  assert.equal(currency.currencyLabel(3), "3 currencys");
  assert.equal(currency.currencySummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(currency.currencySummary({}), "none");
  assert.equal(currency.formatCurrency(" ab1 "), "CUR-AB1");
  assert.equal(currency.parseCurrency("CUR-AB1"), "AB1");
  assert.equal(currency.parseCurrency("zzz"), undefined);
  assert.equal(currency.describeCurrency("CU01"), "standard currency policy");
  assert.match(currency.describeCurrency("nope"), /^unknown currency code/);
});

test("orders/channel", () => {
  assert.equal(channel.channelLabel(1), "1 channel");
  assert.equal(channel.channelLabel(3), "3 channels");
  assert.equal(channel.channelSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(channel.channelSummary({}), "none");
  assert.equal(channel.formatChannel(" ab1 "), "CHA-AB1");
  assert.equal(channel.parseChannel("CHA-AB1"), "AB1");
  assert.equal(channel.parseChannel("zzz"), undefined);
  assert.equal(channel.isChannelValid(128), true);
  assert.equal(channel.isChannelValid(129), false);
  assert.equal(channel.clampChannel(1000), 128);
  assert.equal(channel.describeChannel("CH01"), "express channel ticket");
  assert.match(channel.describeChannel("nope"), /^unknown channel code/);
});

test("orders/source", () => {
  assert.equal(source.formatSource(" ab1 "), "SOU-AB1");
  assert.equal(source.parseSource("SOU-AB1"), "AB1");
  assert.equal(source.parseSource("zzz"), undefined);
  assert.equal(source.isSourceValid(129), true);
  assert.equal(source.isSourceValid(130), false);
  assert.equal(source.clampSource(1000), 129);
  assert.equal(source.sourceWeight("b"), 31);
  assert.equal(source.sourceWeight("z"), 0);
  assert.equal(source.totalSourceWeight(["a", "c", "z"]), 62);
  assert.equal(source.describeSource("SO01"), "fragile source lane");
  assert.match(source.describeSource("nope"), /^unknown source code/);
});

test("orders/campaign", () => {
  assert.equal(campaign.isCampaignValid(130), true);
  assert.equal(campaign.isCampaignValid(131), false);
  assert.equal(campaign.clampCampaign(1000), 130);
  assert.equal(campaign.campaignWeight("b"), 32);
  assert.equal(campaign.campaignWeight("z"), 0);
  assert.equal(campaign.totalCampaignWeight(["a", "c", "z"]), 64);
  assert.equal(campaign.campaignScale(10), 20);
  assert.equal(campaign.campaignShare(1, 4), 25);
  assert.equal(campaign.campaignShare(1, 0), 0);
  assert.equal(campaign.describeCampaign("CA01"), "bulky campaign profile");
  assert.match(campaign.describeCampaign("nope"), /^unknown campaign code/);
});

test("orders/referral", () => {
  assert.equal(referral.referralWeight("b"), 33);
  assert.equal(referral.referralWeight("z"), 0);
  assert.equal(referral.totalReferralWeight(["a", "c", "z"]), 66);
  assert.equal(referral.referralScale(10), 30);
  assert.equal(referral.referralShare(1, 4), 25);
  assert.equal(referral.referralShare(1, 0), 0);
  assert.equal(referral.referralLabel(1), "1 referral");
  assert.equal(referral.referralLabel(3), "3 referrals");
  assert.equal(referral.referralSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(referral.referralSummary({}), "none");
  assert.equal(referral.describeReferral("RE01"), "seasonal referral quota");
  assert.match(referral.describeReferral("nope"), /^unknown referral code/);
});

test("orders/basket", () => {
  assert.equal(basket.basketScale(10), 40);
  assert.equal(basket.basketShare(1, 4), 25);
  assert.equal(basket.basketShare(1, 0), 0);
  assert.equal(basket.basketLabel(1), "1 basket");
  assert.equal(basket.basketLabel(3), "3 baskets");
  assert.equal(basket.basketSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(basket.basketSummary({}), "none");
  assert.equal(basket.formatBasket(" ab1 "), "BAS-AB1");
  assert.equal(basket.parseBasket("BAS-AB1"), "AB1");
  assert.equal(basket.parseBasket("zzz"), undefined);
  assert.equal(basket.describeBasket("BA01"), "returnable basket session");
  assert.match(basket.describeBasket("nope"), /^unknown basket code/);
});

test("orders/promo", () => {
  assert.equal(promo.promoLabel(1), "1 promo");
  assert.equal(promo.promoLabel(3), "3 promos");
  assert.equal(promo.promoSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(promo.promoSummary({}), "none");
  assert.equal(promo.formatPromo(" ab1 "), "PRO-AB1");
  assert.equal(promo.parsePromo("PRO-AB1"), "AB1");
  assert.equal(promo.parsePromo("zzz"), undefined);
  assert.equal(promo.isPromoValid(133), true);
  assert.equal(promo.isPromoValid(134), false);
  assert.equal(promo.clampPromo(1000), 133);
  assert.equal(promo.describePromo("PR01"), "perishable promo plan");
  assert.match(promo.describePromo("nope"), /^unknown promo code/);
});

test("orders/upsell", () => {
  assert.equal(upsell.formatUpsell(" ab1 "), "UPS-AB1");
  assert.equal(upsell.parseUpsell("UPS-AB1"), "AB1");
  assert.equal(upsell.parseUpsell("zzz"), undefined);
  assert.equal(upsell.isUpsellValid(134), true);
  assert.equal(upsell.isUpsellValid(135), false);
  assert.equal(upsell.clampUpsell(1000), 134);
  assert.equal(upsell.upsellWeight("b"), 36);
  assert.equal(upsell.upsellWeight("z"), 0);
  assert.equal(upsell.totalUpsellWeight(["a", "c", "z"]), 72);
  assert.equal(upsell.describeUpsell("UP01"), "regulated upsell entry");
  assert.match(upsell.describeUpsell("nope"), /^unknown upsell code/);
});

test("orders/fraudcheck", () => {
  assert.equal(fraudcheck.isFraudcheckValid(135), true);
  assert.equal(fraudcheck.isFraudcheckValid(136), false);
  assert.equal(fraudcheck.clampFraudcheck(1000), 135);
  assert.equal(fraudcheck.fraudcheckWeight("b"), 37);
  assert.equal(fraudcheck.fraudcheckWeight("z"), 0);
  assert.equal(fraudcheck.totalFraudcheckWeight(["a", "c", "z"]), 74);
  assert.equal(fraudcheck.fraudcheckScale(10), 20);
  assert.equal(fraudcheck.fraudcheckShare(1, 4), 25);
  assert.equal(fraudcheck.fraudcheckShare(1, 0), 0);
  assert.equal(fraudcheck.describeFraudcheck("FR01"), "oversized fraudcheck window");
  assert.match(fraudcheck.describeFraudcheck("nope"), /^unknown fraudcheck code/);
});

test("orders/handling", () => {
  assert.equal(handling.handlingWeight("b"), 38);
  assert.equal(handling.handlingWeight("z"), 0);
  assert.equal(handling.totalHandlingWeight(["a", "c", "z"]), 76);
  assert.equal(handling.handlingScale(10), 30);
  assert.equal(handling.handlingShare(1, 4), 25);
  assert.equal(handling.handlingShare(1, 0), 0);
  assert.equal(handling.handlingLabel(1), "1 handling");
  assert.equal(handling.handlingLabel(3), "3 handlings");
  assert.equal(handling.handlingSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(handling.handlingSummary({}), "none");
  assert.equal(handling.describeHandling("HA01"), "premium handling check");
  assert.match(handling.describeHandling("nope"), /^unknown handling code/);
});

test("orders/label-print", () => {
  assert.equal(labelPrint.labelPrintScale(10), 40);
  assert.equal(labelPrint.labelPrintShare(1, 4), 25);
  assert.equal(labelPrint.labelPrintShare(1, 0), 0);
  assert.equal(labelPrint.labelPrintLabel(1), "1 label-print");
  assert.equal(labelPrint.labelPrintLabel(3), "3 label-prints");
  assert.equal(labelPrint.labelPrintSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(labelPrint.labelPrintSummary({}), "none");
  assert.equal(labelPrint.formatLabelPrint(" ab1 "), "LAB-AB1");
  assert.equal(labelPrint.parseLabelPrint("LAB-AB1"), "AB1");
  assert.equal(labelPrint.parseLabelPrint("zzz"), undefined);
  assert.equal(labelPrint.describeLabelPrint("LA01"), "discounted label-print slot");
  assert.match(labelPrint.describeLabelPrint("nope"), /^unknown label-print code/);
});

test("orders/gifting", () => {
  assert.equal(gifting.giftingLabel(1), "1 gifting");
  assert.equal(gifting.giftingLabel(3), "3 giftings");
  assert.equal(gifting.giftingSummary({ a: 2, b: 0 }), "a: 2");
  assert.equal(gifting.giftingSummary({}), "none");
  assert.equal(gifting.formatGifting(" ab1 "), "GIF-AB1");
  assert.equal(gifting.parseGifting("GIF-AB1"), "AB1");
  assert.equal(gifting.parseGifting("zzz"), undefined);
  assert.equal(gifting.isGiftingValid(138), true);
  assert.equal(gifting.isGiftingValid(139), false);
  assert.equal(gifting.clampGifting(1000), 138);
  assert.equal(gifting.describeGifting("GI01"), "limited gifting group");
  assert.match(gifting.describeGifting("nope"), /^unknown gifting code/);
});

test("orders/note", () => {
  assert.equal(note.formatNote(" ab1 "), "NOT-AB1");
  assert.equal(note.parseNote("NOT-AB1"), "AB1");
  assert.equal(note.parseNote("zzz"), undefined);
  assert.equal(note.isNoteValid(139), true);
  assert.equal(note.isNoteValid(140), false);
  assert.equal(note.clampNote(1000), 139);
  assert.equal(note.noteWeight("b"), 41);
  assert.equal(note.noteWeight("z"), 0);
  assert.equal(note.totalNoteWeight(["a", "c", "z"]), 82);
  assert.equal(note.describeNote("NO01"), "archived note cap");
  assert.match(note.describeNote("nope"), /^unknown note code/);
});
