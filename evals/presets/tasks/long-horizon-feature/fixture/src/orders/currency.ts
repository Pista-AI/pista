export function currencyScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}
