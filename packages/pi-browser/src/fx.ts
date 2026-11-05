// Coarse exchange rates, used only to tell whether a charge in one currency is plausibly an invoice in another (a band check, never a conversion to pay or book).

/**
 * Approximate mid rates, units of each currency per 1 EUR. Coarse 2026 values: good to a few percent, so a caller must treat a
 * match through them as a band check and pass learned per-site rates (see `rateFor` in the matcher options) when it has them.
 */
export const EUR_RATES: Readonly<Record<string, number>> = { EUR: 1, USD: 1.12, GBP: 0.86, SEK: 11.2, NOK: 11.7, DKK: 7.46, CHF: 0.94 };

export type RateTable = Readonly<Record<string, number>>;

/** How many `to` one `from` buys, from a table of units per base currency; undefined when either currency is unknown. */
export function rateFor(from: string, to: string, table: RateTable = EUR_RATES): number | undefined {
  const a = table[from.toUpperCase()], b = table[to.toUpperCase()];
  return a && b ? b / a : undefined;
}
