import { isoDate } from "../calendar/format.ts";
import type { Order } from "../orders/order.ts";

/** Orders grouped by the day they leave the warehouse. */
export function shipmentsByDay(orders: Order[]): Record<string, string[]> {
  const days: Record<string, string[]> = {};
  for (const o of orders) (days[isoDate(o.shipOn)] ??= []).push(o.id);
  return days;
}
