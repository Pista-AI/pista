export function isNoteValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 112;
}
