export function isStatementValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 114;
}
