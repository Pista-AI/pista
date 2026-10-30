/** cancel codes are upper-case and prefixed. */
export function formatCancel(value: string): string {
  return "CAN-" + value.trim().toUpperCase();
}
