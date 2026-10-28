/** All amounts are integer cents (öre); 100 cents = 1 SEK. */
export function sek(amount: number): number {
  return Math.round(amount * 100);
}

export function formatCents(cents: number): string {
  return `${(cents / 100).toFixed(2)} SEK`;
}

export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}
