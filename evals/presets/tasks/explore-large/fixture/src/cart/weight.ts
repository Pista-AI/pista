import { findProduct } from "../catalog/products.ts";
import type { Cart } from "./cart.ts";

export function weightGrams(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + findProduct(l.productId).weightGrams * l.qty, 0);
}
