/** window codes are upper-case and prefixed. */
export function formatWindow(value: string): string {
  return "WIN-" + value.trim().toUpperCase();
}
