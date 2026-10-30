/** tracking codes are upper-case and prefixed. */
export function formatTracking(value: string): string {
  return "TRA-" + value.trim().toUpperCase();
}
