import { isReducedVat } from "../catalog/categories.ts";
import { findProduct } from "../catalog/lookup.ts";
import type { Cart } from "../cart/cart.ts";
import { VAT } from "./rates.ts";

/** VAT included in the cart's prices, per line, after the cart-wide discount ratio. */
export function vatCents(cart: Cart, country: string, discountRatio: number): number {
  const rates = VAT[country];
  if (!rates) throw new Error(`no VAT rates for ${country}`);
  return cart.lines.reduce((sum, l) => {
    const p = findProduct(l.productId);
    const rate = isReducedVat(p.category) ? rates.reduced : rates.standard;
    const gross = Math.round(p.priceCents * l.qty * (1 - discountRatio));
    return sum + gross - Math.round(gross / (1 + rate / 100));
  }, 0);
}
