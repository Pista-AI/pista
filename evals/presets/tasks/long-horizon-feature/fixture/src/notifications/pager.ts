/** pager codes are upper-case and prefixed. */
export function formatPager(value: string): string {
  return "PAG-" + value.trim().toUpperCase();
}
