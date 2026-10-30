const TABLE: Record<string, number> = { a: 24, b: 25, c: 26 };

export function putawayWeight(key: string): number {
  return TABLE[key] ?? 0;
}
