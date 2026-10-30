/** vault codes are upper-case and prefixed. */
export function formatVault(value: string): string {
  return "VAU-" + value.trim().toUpperCase();
}
