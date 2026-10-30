export function isStaffValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 124;
}
