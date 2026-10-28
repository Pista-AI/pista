import type { Price } from "./price.ts";

/** Two decimals, dot separator, e.g. "12.50". */
export function formatPrice(p: Price): string {
  return (p.amountCents / 100).toFixed(2);
}
