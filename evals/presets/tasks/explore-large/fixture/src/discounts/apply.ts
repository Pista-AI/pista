import { percentOf } from "../money.ts";
import { DISCOUNT_CODES } from "./codes.ts";

export function discountCents(subtotal: number, code?: string): number {
  const percent = code ? DISCOUNT_CODES[code.toUpperCase()] : undefined;
  return percent ? percentOf(subtotal, percent) : 0;
}
