import { type OrderLine, lineTotal } from "./lines.ts";

const TIERS: [number, number][] = [[100, 15], [50, 10], [10, 5]];

export function bulkDiscountCents(lines: OrderLine[]): number {
  let sum = 0;
  for (const line of lines) {
    const tier = TIERS.find(([min]) => line.qty >= min);
    if (tier) sum += Math.floor((lineTotal(line) * tier[1]) / 100);
  }
  return sum;
}
