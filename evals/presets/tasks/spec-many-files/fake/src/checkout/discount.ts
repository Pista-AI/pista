import { price, type Price } from "../money/price.ts";

/** The discount amount for a percentage off, rounded to whole cents. */
export function percentOff(total: Price, percent: number): Price {
  return price(Math.round((total.amountCents * percent) / 100), total.currency);
}
