import { VAT_PERCENT } from "./rates.ts";

/** VAT contained in a gross amount. */
export function vatIncluded(grossCents: number, country: string): number {
  const rate = VAT_PERCENT[country] ?? 0;
  return grossCents - Math.round(grossCents / (1 + rate / 100));
}
