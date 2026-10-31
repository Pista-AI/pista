export function reviewScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}
