/** proration codes are upper-case and prefixed. */
export function formatProration(value: string): string {
  return "PRO-" + value.trim().toUpperCase();
}
