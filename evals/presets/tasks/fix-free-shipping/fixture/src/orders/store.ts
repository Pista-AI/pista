import type { Order } from "./order.ts";

const orders = new Map<string, Order>();

export function saveOrder(order: Order): void {
  orders.set(order.id, order);
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function ordersFor(customerId: string): Order[] {
  return [...orders.values()].filter((o) => o.customerId === customerId);
}
