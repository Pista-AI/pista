import { findProduct } from "../catalog/lookup.ts";
import type { Cart } from "./cart.ts";

export function totalWeightGrams(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + findProduct(l.sku).weightGrams * l.qty, 0);
}
