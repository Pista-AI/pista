const TABLE: Record<string, number> = { a: 10, b: 11, c: 12 };

export function currencyWeight(key: string): number {
  return TABLE[key] ?? 0;
}
