const TABLE: Record<string, number> = { a: 1, b: 2, c: 3 };

export function dailyWeight(key: string): number {
  return TABLE[key] ?? 0;
}
