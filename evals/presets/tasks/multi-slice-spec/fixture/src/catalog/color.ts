const TABLE: Record<string, number> = { a: 6, b: 7, c: 8 };

export function colorWeight(key: string): number {
  return TABLE[key] ?? 0;
}
