export function isPauseValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 124;
}
