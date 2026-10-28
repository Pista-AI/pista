import { findCustomer } from "../customers/customers.ts";
import type { Order } from "../orders/order.ts";
import { fill } from "./templates.ts";

export function orderConfirmation(order: Order): string {
  return fill("Hi {name}, we received order {id}.", { name: findCustomer(order.customerId).name, id: order.id });
}
