/** gift codes are upper-case and prefixed. */
export function formatGift(value: string): string {
  return "GIF-" + value.trim().toUpperCase();
}
