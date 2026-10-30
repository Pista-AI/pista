/** aging codes are upper-case and prefixed. */
export function formatAging(value: string): string {
  return "AGI-" + value.trim().toUpperCase();
}
