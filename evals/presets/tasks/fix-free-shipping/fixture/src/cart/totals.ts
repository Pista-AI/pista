import { findProduct } from "../catalog/lookup.ts";
import type { Cart } from "./cart.ts";

export function subtotalCents(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + findProduct(l.productId).priceCents * l.qty, 0);
}
