/** quarterly codes are upper-case and prefixed. */
export function formatQuarterly(value: string): string {
  return "QUA-" + value.trim().toUpperCase();
}
