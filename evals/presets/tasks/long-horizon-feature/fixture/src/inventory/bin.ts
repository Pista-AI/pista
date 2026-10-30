/** bin codes are upper-case and prefixed. */
export function formatBin(value: string): string {
  return "BIN-" + value.trim().toUpperCase();
}
