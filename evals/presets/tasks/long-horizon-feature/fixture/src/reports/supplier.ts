/** supplier codes are upper-case and prefixed. */
export function formatSupplier(value: string): string {
  return "SUP-" + value.trim().toUpperCase();
}
