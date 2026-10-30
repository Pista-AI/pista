/** bay codes are upper-case and prefixed. */
export function formatBay(value: string): string {
  return "BAY-" + value.trim().toUpperCase();
}
