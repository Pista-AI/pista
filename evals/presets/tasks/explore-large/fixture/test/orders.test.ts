import assert from "node:assert/strict";
import { test } from "node:test";
import { addLine, emptyCart, estimateDelivery, getOrder, placeOrder, shippingNotice, shipmentsByDay } from "../src/index.ts";

const cart = addLine(emptyCart(), "mug-01");

test("an order placed before the cutoff on a weekday ships the same day", () => {
  const order = placeOrder("c-1", cart, new Date("2026-03-04T09:00:00Z"));
  assert.equal(order.shipOn.toISOString(), "2026-03-04T00:00:00.000Z");
  assert.equal(getOrder(order.id), order);
});

test("an order placed after the cutoff ships the next day", () => {
  const order = placeOrder("c-1", cart, new Date("2026-03-04T15:30:00Z"));
  assert.equal(order.shipOn.toISOString(), "2026-03-05T00:00:00.000Z");
});

test("weekend orders ship on Monday", () => {
  const order = placeOrder("c-2", cart, new Date("2026-03-07T11:00:00Z"));
  assert.equal(order.shipOn.toISOString(), "2026-03-09T00:00:00.000Z");
});

test("delivery estimate adds the zone's transit days to the dispatch day", () => {
  const order = placeOrder("c-3", cart, new Date("2026-03-04T09:00:00Z"));
  assert.equal(estimateDelivery(order).toISOString(), "2026-03-10T00:00:00.000Z");
});

test("notices and reports use the ship day", () => {
  const order = placeOrder("c-1", cart, new Date("2026-03-11T09:00:00Z"));
  assert.equal(shippingNotice(order), `Hi Astrid, order ${order.id} ships on 2026-03-11.`);
  assert.deepEqual(shipmentsByDay([order]), { "2026-03-11": [order.id] });
});
