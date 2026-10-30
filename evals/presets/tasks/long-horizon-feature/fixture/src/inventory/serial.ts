export function serialScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}
