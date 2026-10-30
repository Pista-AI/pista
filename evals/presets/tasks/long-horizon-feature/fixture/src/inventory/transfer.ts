/** transfer codes are upper-case and prefixed. */
export function formatTransfer(value: string): string {
  return "TRA-" + value.trim().toUpperCase();
}
