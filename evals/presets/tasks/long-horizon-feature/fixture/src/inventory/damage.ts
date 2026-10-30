const TABLE: Record<string, number> = { a: 29, b: 30, c: 31 };

export function damageWeight(key: string): number {
  return TABLE[key] ?? 0;
}
