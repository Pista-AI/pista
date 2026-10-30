const TABLE: Record<string, number> = { a: 22, b: 23, c: 24 };

export function taxWeight(key: string): number {
  return TABLE[key] ?? 0;
}
