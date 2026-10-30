/** push codes are upper-case and prefixed. */
export function formatPush(value: string): string {
  return "PUS-" + value.trim().toUpperCase();
}
