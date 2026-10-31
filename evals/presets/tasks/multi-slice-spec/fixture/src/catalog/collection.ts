/** collection codes are upper-case and prefixed. */
export function formatCollection(value: string): string {
  return "COL-" + value.trim().toUpperCase();
}
