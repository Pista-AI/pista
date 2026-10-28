/** Amounts are stored as integer cents and shown with a dot and two decimals, no currency symbol. */
export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}
