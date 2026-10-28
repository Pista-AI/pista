import { lineTotal, type CartLine } from "../cart/cart.ts";
import { negate, type Price } from "../money/price.ts";

/** A refund is the negated line total. */
export function refundLine(line: CartLine): Price {
  return negate(lineTotal(line));
}
