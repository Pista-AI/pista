export type PaymentMethod = "card" | "invoice" | "swish";

export function feeCents(method: PaymentMethod, amountCents: number): number {
  return method === "card" ? Math.round(amountCents * 0.015) : method === "swish" ? 200 : 0;
}
