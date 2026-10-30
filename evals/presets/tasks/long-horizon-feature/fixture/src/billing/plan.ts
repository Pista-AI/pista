export function isPlanValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 119;
}
