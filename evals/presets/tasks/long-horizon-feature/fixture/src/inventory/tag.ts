const TABLE: Record<string, number> = { a: 19, b: 20, c: 21 };

export function tagWeight(key: string): number {
  return TABLE[key] ?? 0;
}
