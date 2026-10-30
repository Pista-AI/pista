const TABLE: Record<string, number> = { a: 14, b: 15, c: 16 };

export function crateWeight(key: string): number {
  return TABLE[key] ?? 0;
}
