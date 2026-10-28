/** All amounts are integer cents. */
export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

export function formatCents(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}
