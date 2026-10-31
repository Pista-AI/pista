/** segment codes are upper-case and prefixed. */
export function formatSegment(value: string): string {
  return "SEG-" + value.trim().toUpperCase();
}
