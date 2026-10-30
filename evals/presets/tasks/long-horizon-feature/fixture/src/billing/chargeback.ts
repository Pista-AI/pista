/** chargeback codes are upper-case and prefixed. */
export function formatChargeback(value: string): string {
  return "CHA-" + value.trim().toUpperCase();
}
