/** terminal codes are upper-case and prefixed. */
export function formatTerminal(value: string): string {
  return "TER-" + value.trim().toUpperCase();
}
