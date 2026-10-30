export function invoiceLabel(count: number): string {
  return count === 1 ? "1 invoice" : `${count} invoices`;
}
