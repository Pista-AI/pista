import type { Cart } from "../cart/cart.ts";
import { subtotalCents } from "../cart/totals.ts";
import { discountCents } from "../discounts/apply.ts";
import { shippingCents } from "../shipping/quote.ts";
import { vatCents } from "../tax/vat.ts";

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  /** VAT included in the goods (shipping is VAT-free here). */
  vatCents: number;
}

export function checkout(cart: Cart, country: string, code?: string): Totals {
  const subtotal = subtotalCents(cart);
  const discount = discountCents(subtotal, code);
  const shipping = shippingCents(cart, country, subtotal - discount);
  const ratio = subtotal === 0 ? 0 : discount / subtotal;
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    shippingCents: shipping,
    totalCents: subtotal - discount + shipping,
    vatCents: vatCents(cart, country, ratio),
  };
}
