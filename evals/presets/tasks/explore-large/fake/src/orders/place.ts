import type { Cart } from "../cart/cart.ts";
import { subtotalCents } from "../cart/totals.ts";
import { findCustomer } from "../customers/customers.ts";
import { discountCents } from "../discounts/apply.ts";
import { shippingCents } from "../shipping/quote.ts";
import { dispatchDate } from "../shipping/dispatch.ts";
import type { Order } from "./order.ts";
import { nextOrderId, saveOrder } from "./store.ts";

export function placeOrder(customerId: string, cart: Cart, placedAt: Date, discountCode?: string): Order {
  const customer = findCustomer(customerId);
  const subtotal = subtotalCents(cart);
  const shipping = shippingCents(customer.address.country);
  const order: Order = {
    id: nextOrderId(),
    customerId,
    lines: cart.lines,
    totalCents: subtotal - discountCents(subtotal, discountCode) + shipping,
    shippingCents: shipping,
    shipTo: customer.address,
    placedAt,
    shipOn: dispatchDate(placedAt, customer.address.country),
  };
  saveOrder(order);
  return order;
}
