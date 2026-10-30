export function backorderScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}
