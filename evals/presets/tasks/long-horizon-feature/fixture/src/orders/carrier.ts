export function carrierScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}
