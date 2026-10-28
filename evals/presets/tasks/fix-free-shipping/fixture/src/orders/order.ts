import type { Cart, CartLine } from "../cart/cart.ts";
import { checkout, type Totals } from "../checkout/checkout.ts";
import { findCustomer } from "../customers/customers.ts";

export interface Order {
  id: string;
  customerId: string;
  lines: CartLine[];
  totals: Totals;
}

let next = 1;

export function placeOrder(customerId: string, cart: Cart, code?: string): Order {
  const customer = findCustomer(customerId);
  const id = `o-${next++}`;
  return { id, customerId: customer.id, lines: cart.lines.map((l) => ({ ...l })), totals: checkout(cart, customer.country, code) };
}
