/** token codes are upper-case and prefixed. */
export function formatToken(value: string): string {
  return "TOK-" + value.trim().toUpperCase();
}
