/** dock codes are upper-case and prefixed. */
export function formatDock(value: string): string {
  return "DOC-" + value.trim().toUpperCase();
}
