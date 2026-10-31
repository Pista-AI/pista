export function settleLabel(count: number): string {
  return count === 1 ? "1 settle" : `${count} settles`;
}
