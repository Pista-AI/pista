const TABLE: Record<string, number> = { a: 25, b: 26, c: 27 };

export function alertWeight(key: string): number {
  return TABLE[key] ?? 0;
}
