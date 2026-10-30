const TABLE: Record<string, number> = { a: 2, b: 3, c: 4 };

export function checkoutWeight(key: string): number {
  return TABLE[key] ?? 0;
}
