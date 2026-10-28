import type { PaymentMethod } from "./methods.ts";

/** Refunds return the full amount; the payment fee is not refunded. */
export function refundCents(_method: PaymentMethod, amountCents: number): number {
  return amountCents;
}
