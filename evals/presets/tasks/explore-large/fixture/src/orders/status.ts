import type { Order } from "./order.ts";

export type OrderStatus = "placed" | "shipped";

export function statusAt(order: Order, now: Date): OrderStatus {
  return now.getTime() >= order.shipOn.getTime() ? "shipped" : "placed";
}
