/** receipt codes are upper-case and prefixed. */
export function formatReceipt(value: string): string {
  return "REC-" + value.trim().toUpperCase();
}
