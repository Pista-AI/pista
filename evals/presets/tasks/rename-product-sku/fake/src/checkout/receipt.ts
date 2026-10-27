import { findProduct } from "../catalog/lookup.ts";
import type { Cart } from "../cart/cart.ts";
import { formatCents } from "../money.ts";
import type { Totals } from "./checkout.ts";

export function receipt(cart: Cart, totals: Totals): string {
  const lines = cart.lines.map((l) => `${l.qty} x ${findProduct(l.sku).name}`);
  lines.push(`Subtotal ${formatCents(totals.subtotalCents)}`);
  if (totals.discountCents) lines.push(`Discount -${formatCents(totals.discountCents)}`);
  lines.push(`Shipping ${totals.shippingCents ? formatCents(totals.shippingCents) : "free"}`);
  lines.push(`Total ${formatCents(totals.totalCents)} (VAT ${formatCents(totals.vatCents)})`);
  return lines.join("\n");
}
