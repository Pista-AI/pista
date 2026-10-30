/** ship codes are upper-case and prefixed. */
export function formatShip(value: string): string {
  return "SHI-" + value.trim().toUpperCase();
}
