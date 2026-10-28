import { allocate } from "../lib/allocate.ts";

export interface InvoiceLine {
  description: string;
  amountCents: number;
}

/** Spreads an invoice-level fee over the lines in proportion to their amounts. */
export function spreadFee(lines: InvoiceLine[], feeCents: number): InvoiceLine[] {
  const shares = allocate(feeCents, lines.map((l) => l.amountCents));
  return lines.map((l, i) => ({ ...l, amountCents: l.amountCents + shares[i]! }));
}

export function invoiceTotal(lines: InvoiceLine[]): number {
  return lines.reduce((sum, l) => sum + l.amountCents, 0);
}
