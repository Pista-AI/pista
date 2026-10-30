export function isSettlementValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 109;
}
