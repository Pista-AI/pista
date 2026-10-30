/** debit codes are upper-case and prefixed. */
export function formatDebit(value: string): string {
  return "DEB-" + value.trim().toUpperCase();
}
