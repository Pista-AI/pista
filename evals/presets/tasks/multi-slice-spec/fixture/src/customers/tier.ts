export function isTierValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 102;
}
