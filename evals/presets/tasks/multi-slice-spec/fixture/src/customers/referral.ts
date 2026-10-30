export function referralLabel(count: number): string {
  return count === 1 ? "1 referral" : `${count} referrals`;
}
