export interface VatRates {
  standard: number;
  reduced: number;
}

export const VAT: Record<string, VatRates> = {
  SE: { standard: 25, reduced: 6 },
  NO: { standard: 25, reduced: 0 },
  DK: { standard: 25, reduced: 25 },
  FI: { standard: 25.5, reduced: 10 },
  DE: { standard: 19, reduced: 7 },
};
