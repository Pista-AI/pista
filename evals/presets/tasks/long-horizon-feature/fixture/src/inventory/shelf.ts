export function isShelfValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 102;
}
