import { DomainError } from "../errors.ts";
import type { OrderLine } from "./lines.ts";

export interface Order {
  id: string;
  customerId: string;
  lines: OrderLine[];
  status: "open" | "shipped" | "cancelled";
}

export class OrderStore {
  private readonly orders = new Map<string, Order>();

  add(order: Order): void {
    if (this.orders.has(order.id)) throw new DomainError("order-exists", `order already exists: ${order.id}`);
    this.orders.set(order.id, order);
  }

  find(id: string): Order | undefined {
    return this.orders.get(id);
  }

  all(): Order[] {
    return [...this.orders.values()];
  }
}
