export function isCartValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 100;
}
