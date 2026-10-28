import assert from "node:assert/strict";
import { test } from "node:test";
import { addLine, emptyCart, estimateDelivery, isBusinessDay, nextBusinessDay, placeOrder, settleOn, shipmentsByDay, shippingNotice } from "./src/index.ts";

const cart = addLine(emptyCart(), "mug-01");
const shipDay = (customer: string, placedAt: string) => placeOrder(customer, cart, new Date(placedAt)).shipOn.toISOString().slice(0, 10);

test("an order placed on a public holiday ships on the next business day", () => {
  assert.equal(shipDay("c-1", "2026-12-25T10:00:00Z"), "2026-12-28"); // Christmas Day (Fri), then the weekend
  assert.equal(shipDay("c-1", "2026-04-03T08:00:00Z"), "2026-04-07"); // Good Friday + weekend + Easter Monday
  assert.equal(shipDay("c-1", "2026-05-14T09:00:00Z"), "2026-05-15"); // Ascension Day
  assert.equal(shipDay("c-3", "2026-10-03T09:00:00Z"), "2026-10-05"); // German Unity Day (Saturday)
});

test("an order placed after the cutoff the evening before a holiday skips the holiday", () => {
  assert.equal(shipDay("c-1", "2026-12-24T15:00:00Z"), "2026-12-28");
  assert.equal(shipDay("c-1", "2026-05-13T14:00:00Z"), "2026-05-15");
});

test("the holiday calendar of the destination country decides", () => {
  assert.equal(shipDay("c-1", "2026-04-01T15:00:00Z"), "2026-04-02"); // Maundy Thursday is not a Swedish holiday
  assert.equal(shipDay("c-2", "2026-04-01T15:00:00Z"), "2026-04-07"); // it is a Norwegian one
  assert.equal(shipDay("c-2", "2026-05-15T09:00:00Z"), "2026-05-15");
  assert.equal(shipDay("c-1", "2026-05-17T09:00:00Z"), "2026-05-18"); // Sunday anyway
  assert.equal(shipDay("c-2", "2026-05-25T09:00:00Z"), "2026-05-26"); // Whit Monday, Norway
  assert.equal(shipDay("c-1", "2026-05-25T09:00:00Z"), "2026-05-25"); // working day in Sweden
});

test("ordinary days and weekends are unchanged", () => {
  assert.equal(shipDay("c-1", "2026-03-04T09:00:00Z"), "2026-03-04");
  assert.equal(shipDay("c-1", "2026-03-04T15:00:00Z"), "2026-03-05");
  assert.equal(shipDay("c-2", "2026-03-07T11:00:00Z"), "2026-03-09");
});

test("delivery estimate, notice and shipment report follow the real ship day", () => {
  const order = placeOrder("c-1", cart, new Date("2026-12-25T10:00:00Z"));
  assert.equal(estimateDelivery(order).toISOString().slice(0, 10), "2026-12-30"); // Mon 28 + 2 days domestic
  assert.equal(shippingNotice(order), `Hi Astrid, order ${order.id} ships on 2026-12-28.`);
  assert.deepEqual(shipmentsByDay([order]), { "2026-12-28": [order.id] });
  const norway = placeOrder("c-2", cart, new Date("2026-04-01T15:00:00Z"));
  assert.equal(estimateDelivery(norway).toISOString().slice(0, 10), "2026-04-11"); // Tue 7 + 4 nordic
});

test("the shared calendar and bank settlement keep their old behaviour", () => {
  assert.equal(isBusinessDay(new Date("2026-12-25T00:00:00Z")), true); // weekday; no country given
  assert.equal(nextBusinessDay(new Date("2026-05-14T00:00:00Z")).toISOString().slice(0, 10), "2026-05-14");
  assert.equal(settleOn(new Date("2026-05-13T10:00:00Z")).toISOString().slice(0, 10), "2026-05-14");
  assert.equal(settleOn(new Date("2026-04-02T10:00:00Z")).toISOString().slice(0, 10), "2026-04-07");
});
