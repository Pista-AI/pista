/** Left-pads a non-negative integer with zeros to `width` digits. */
export function padNumber(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}
