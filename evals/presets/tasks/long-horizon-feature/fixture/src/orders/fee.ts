/** fee codes are upper-case and prefixed. */
export function formatFee(value: string): string {
  return "FEE-" + value.trim().toUpperCase();
}
