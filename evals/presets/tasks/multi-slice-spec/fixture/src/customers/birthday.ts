/** birthday codes are upper-case and prefixed. */
export function formatBirthday(value: string): string {
  return "BIR-" + value.trim().toUpperCase();
}
