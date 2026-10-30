/** archive codes are upper-case and prefixed. */
export function formatArchive(value: string): string {
  return "ARC-" + value.trim().toUpperCase();
}
