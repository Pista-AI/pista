/** source codes are upper-case and prefixed. */
export function formatSource(value: string): string {
  return "SOU-" + value.trim().toUpperCase();
}
