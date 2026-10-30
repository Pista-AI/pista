/** label codes are upper-case and prefixed. */
export function formatLabel(value: string): string {
  return "LAB-" + value.trim().toUpperCase();
}
