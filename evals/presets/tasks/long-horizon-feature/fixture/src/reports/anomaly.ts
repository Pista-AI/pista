/** anomaly codes are upper-case and prefixed. */
export function formatAnomaly(value: string): string {
  return "ANO-" + value.trim().toUpperCase();
}
