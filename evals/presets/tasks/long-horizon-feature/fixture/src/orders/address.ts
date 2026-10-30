const TABLE: Record<string, number> = { a: 7, b: 8, c: 9 };

export function addressWeight(key: string): number {
  return TABLE[key] ?? 0;
}
