export function pickScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}
