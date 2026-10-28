import { inStock } from "./stock.ts";

export function canReserve(productId: string, qty: number): boolean {
  return inStock(productId) >= qty;
}
