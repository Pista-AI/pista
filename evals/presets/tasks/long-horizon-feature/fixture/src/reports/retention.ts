/** retention codes are upper-case and prefixed. */
export function formatRetention(value: string): string {
  return "RET-" + value.trim().toUpperCase();
}
