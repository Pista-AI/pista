/** greeting codes are upper-case and prefixed. */
export function formatGreeting(value: string): string {
  return "GRE-" + value.trim().toUpperCase();
}
