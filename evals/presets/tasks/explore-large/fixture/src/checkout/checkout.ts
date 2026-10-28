import type { Cart } from "../cart/cart.ts";
import { subtotalCents } from "../cart/totals.ts";
import { discountCents } from "../discounts/apply.ts";
import { shippingCents } from "../shipping/quote.ts";

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
}

export function checkout(cart: Cart, country: string, discountCode?: string): Totals {
  const subtotal = subtotalCents(cart);
  const discount = discountCents(subtotal, discountCode);
  const shipping = cart.lines.length === 0 ? 0 : shippingCents(country);
  return { subtotalCents: subtotal, discountCents: discount, shippingCents: shipping, totalCents: subtotal - discount + shipping };
}
