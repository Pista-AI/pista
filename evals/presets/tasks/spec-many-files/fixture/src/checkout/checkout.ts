import { cartTotal, type Cart } from "../cart/cart.ts";
import { add, negate, type Price } from "../money/price.ts";
import { percentOff } from "./discount.ts";

export interface Totals {
  subtotal: Price;
  discount: Price;
  total: Price;
}

export function checkout(cart: Cart, discountPercent = 0): Totals {
  const subtotal = cartTotal(cart);
  const discount = percentOff(subtotal, discountPercent);
  return { subtotal, discount, total: add(subtotal, negate(discount)) };
}
