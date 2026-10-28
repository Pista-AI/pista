import type { Order } from "./order.ts";

const orders = new Map<string, Order>();
let counter = 0;

export function nextOrderId(): string {
  counter += 1;
  return `o-${counter}`;
}

export function saveOrder(order: Order): void {
  orders.set(order.id, order);
}

export function getOrder(id: string): Order {
  const order = orders.get(id);
  if (!order) throw new Error(`unknown order ${id}`);
  return order;
}

export function ordersFor(customerId: string): Order[] {
  return [...orders.values()].filter((o) => o.customerId === customerId);
}
