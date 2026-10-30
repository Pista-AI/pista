const TABLE: Record<string, number> = { a: 6, b: 7, c: 8 };

export function cohortWeight(key: string): number {
  return TABLE[key] ?? 0;
}
