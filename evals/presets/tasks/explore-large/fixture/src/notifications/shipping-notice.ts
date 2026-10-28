import { isoDate } from "../calendar/format.ts";
import { findCustomer } from "../customers/customers.ts";
import type { Order } from "../orders/order.ts";
import { fill } from "./templates.ts";

/** Tells the customer which day the order leaves the warehouse. */
export function shippingNotice(order: Order): string {
  return fill("Hi {name}, order {id} ships on {date}.", {
    name: findCustomer(order.customerId).name,
    id: order.id,
    date: isoDate(order.shipOn),
  });
}
