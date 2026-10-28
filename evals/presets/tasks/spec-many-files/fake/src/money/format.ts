import type { Price } from "./price.ts";

/** Two decimals, dot separator, then the currency, e.g. "12.50 SEK". */
export function formatPrice(p: Price): string {
  return `${(p.amountCents / 100).toFixed(2)} ${p.currency}`;
}
