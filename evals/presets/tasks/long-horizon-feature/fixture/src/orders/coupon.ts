export function couponScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}
