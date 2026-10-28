import { currencyFor } from "../currency/currencies.ts";
import { findCustomer } from "../customers/customers.ts";
import { shippingCents } from "../shipping/quote.ts";
import { vatCents } from "../tax/vat.ts";
import { buildLines, type InvoiceLine } from "./lines.ts";

export interface Invoice {
  customerId: string;
  currency: string;
  lines: InvoiceLine[];
  subtotalCents: number;
  vatCents: number;
  shippingCents: number;
  totalCents: number;
}

/** Shipping is charged net and carries VAT like the goods. */
export function createInvoice(customerId: string, items: { productId: string; qty: number }[]): Invoice {
  const customer = findCustomer(customerId);
  const lines = buildLines(items);
  const subtotal = lines.reduce((sum, l) => sum + l.netCents, 0);
  const shipping = shippingCents(customer.country);
  const vat = vatCents(subtotal + shipping, customer.country);
  return {
    customerId,
    currency: currencyFor(customer.country),
    lines,
    subtotalCents: subtotal,
    vatCents: vat,
    shippingCents: shipping,
    totalCents: subtotal + shipping + vat,
  };
}
