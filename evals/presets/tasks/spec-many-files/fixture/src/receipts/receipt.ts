import { findProduct } from "../catalog/products.ts";
import { lineTotal, type Cart } from "../cart/cart.ts";
import { checkout } from "../checkout/checkout.ts";
import { formatPrice } from "../money/format.ts";

export function receipt(cart: Cart, discountPercent = 0): string {
  const lines = cart.lines.map((l) => `${findProduct(l.productId).name} x${l.qty}  ${formatPrice(lineTotal(l))}`);
  const totals = checkout(cart, discountPercent);
  return [...lines, `Total  ${formatPrice(totals.total)}`].join("\n");
}
