export function scanScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}
