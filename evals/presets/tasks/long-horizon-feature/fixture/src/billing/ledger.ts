const TABLE: Record<string, number> = { a: 1, b: 2, c: 3 };

export function ledgerWeight(key: string): number {
  return TABLE[key] ?? 0;
}
