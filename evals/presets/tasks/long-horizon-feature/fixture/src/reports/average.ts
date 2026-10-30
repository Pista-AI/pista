/** average codes are upper-case and prefixed. */
export function formatAverage(value: string): string {
  return "AVE-" + value.trim().toUpperCase();
}
