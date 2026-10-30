const TABLE: Record<string, number> = { a: 26, b: 27, c: 28 };

export function reactivateWeight(key: string): number {
  return TABLE[key] ?? 0;
}
