export function dedupeLabel(count: number): string {
  return count === 1 ? "1 dedupe" : `${count} dedupes`;
}
