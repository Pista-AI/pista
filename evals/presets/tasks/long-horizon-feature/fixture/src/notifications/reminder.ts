export function isReminderValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 123;
}
