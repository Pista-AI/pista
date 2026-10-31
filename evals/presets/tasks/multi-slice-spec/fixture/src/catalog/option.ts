/** option codes are upper-case and prefixed. */
export function formatOption(value: string): string {
  return "OPT-" + value.trim().toUpperCase();
}
