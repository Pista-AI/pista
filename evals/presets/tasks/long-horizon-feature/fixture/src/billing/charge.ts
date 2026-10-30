export function isChargeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 104;
}
