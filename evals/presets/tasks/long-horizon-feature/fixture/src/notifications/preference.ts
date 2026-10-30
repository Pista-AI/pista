export function preferenceScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}
