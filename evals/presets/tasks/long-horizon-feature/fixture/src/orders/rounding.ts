const TABLE: Record<string, number> = { a: 27, b: 28, c: 29 };

export function roundingWeight(key: string): number {
  return TABLE[key] ?? 0;
}
