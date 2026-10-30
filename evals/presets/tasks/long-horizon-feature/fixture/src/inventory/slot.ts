export function isSlotValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 117;
}
