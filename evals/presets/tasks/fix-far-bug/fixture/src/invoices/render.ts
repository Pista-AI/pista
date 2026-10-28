import { formatCents } from "../money.ts";
import type { Invoice } from "./invoice.ts";

export function renderInvoice(invoice: Invoice): string {
  const rows = invoice.lines.map((l) => `${l.name} x${l.qty}  ${formatCents(l.netCents, invoice.currency)}`);
  return [
    ...rows,
    `Shipping  ${formatCents(invoice.shippingCents, invoice.currency)}`,
    `VAT  ${formatCents(invoice.vatCents, invoice.currency)}`,
    `Total  ${formatCents(invoice.totalCents, invoice.currency)}`,
  ].join("\n");
}
