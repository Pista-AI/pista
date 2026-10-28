/**
 * Splits an amount of integer cents across weights so the parts add up to the total exactly.
 * Each part gets its proportional share rounded down; the cents left over are handed out one
 * each to the parts with the largest fractional remainder, earlier parts first on ties.
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  if (!Number.isInteger(totalCents)) throw new RangeError("total must be whole cents");
  if (weights.length === 0 || weights.some((w) => !(w > 0))) throw new RangeError("weights must be positive");
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const parts = exact.map((x) => Math.floor(x));
  let remainder = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder === 0) break;
    parts[i]! += 1;
    remainder -= 1;
  }
  return parts;
}
