/** bundle codes are upper-case and prefixed. */
export function formatBundle(value: string): string {
  return "BUN-" + value.trim().toUpperCase();
}
