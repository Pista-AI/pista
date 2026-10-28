import { findProduct } from "../catalog/products.ts";
import { formatCents } from "../money.ts";
import type { Order } from "../orders/order.ts";

export function receipt(order: Order): string {
  const lines = order.lines.map((l) => `${findProduct(l.productId).name} x${l.qty}`);
  return [...lines, `Shipping ${formatCents(order.shippingCents)}`, `Total ${formatCents(order.totalCents)}`].join("\n");
}
