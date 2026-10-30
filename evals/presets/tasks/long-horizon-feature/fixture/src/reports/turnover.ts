export function isTurnoverValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 129;
}
