/** audit codes are upper-case and prefixed. */
export function formatAudit(value: string): string {
  return "AUD-" + value.trim().toUpperCase();
}
