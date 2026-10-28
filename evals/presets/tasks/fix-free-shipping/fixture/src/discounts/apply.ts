import { percentOf } from "../money.ts";
import { CODES } from "./codes.ts";

/** Discount in cents for `code` on `subtotalCents`; unknown or missing codes give 0. */
export function discountCents(subtotalCents: number, code?: string): number {
  if (!code) return 0;
  const found = CODES.find((c) => c.code === code.toUpperCase());
  return found ? percentOf(subtotalCents, found.percent) : 0;
}
