const TABLE: Record<string, number> = { a: 11, b: 12, c: 13 };

export function revenueWeight(key: string): number {
  return TABLE[key] ?? 0;
}
