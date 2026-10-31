/** locale codes are upper-case and prefixed. */
export function formatLocale(value: string): string {
  return "LOC-" + value.trim().toUpperCase();
}
