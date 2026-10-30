export function isSubscriptionValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 120;
}
