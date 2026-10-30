const TABLE: Record<string, number> = { a: 17, b: 18, c: 19 };

export function exchangeWeight(key: string): number {
  return TABLE[key] ?? 0;
}
