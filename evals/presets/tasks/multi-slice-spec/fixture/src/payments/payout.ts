/** payout codes are upper-case and prefixed. */
export function formatPayout(value: string): string {
  return "PAY-" + value.trim().toUpperCase();
}
