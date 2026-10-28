/** Standard VAT per country in percent, keyed by alpha-2 code. */
export const VAT_RATES: Record<string, number> = {
  SE: 25,
  NO: 25,
  DK: 25,
  FI: 25.5,
  DE: 19,
};

export const DEFAULT_VAT = 0;
