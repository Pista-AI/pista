export function recallLabel(count: number): string {
  return count === 1 ? "1 recall" : `${count} recalls`;
}
