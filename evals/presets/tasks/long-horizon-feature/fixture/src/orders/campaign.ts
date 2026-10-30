export function isCampaignValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 130;
}
