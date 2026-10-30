const TABLE: Record<string, number> = { a: 4, b: 5, c: 6 };

export function palletWeight(key: string): number {
  return TABLE[key] ?? 0;
}
