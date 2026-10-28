import type { Order } from "../orders/order.ts";

export function salesTotalCents(orders: Order[]): number {
  return orders.reduce((sum, o) => sum + o.totalCents, 0);
}
