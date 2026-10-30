export function mandateScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}
