import type { Cart } from "../cart/cart.ts";
import { totalWeightGrams } from "../cart/weight.ts";
import { rateCents } from "./rates.ts";
import { shipsFree } from "./rules.ts";
import { zoneFor } from "./zones.ts";

/** Shipping for `cart` to `country`, given the subtotal after discounts. */
export function shippingCents(cart: Cart, country: string, discountedSubtotalCents: number): number {
  if (cart.lines.length === 0 || shipsFree(discountedSubtotalCents)) return 0;
  return rateCents(zoneFor(country), totalWeightGrams(cart));
}
