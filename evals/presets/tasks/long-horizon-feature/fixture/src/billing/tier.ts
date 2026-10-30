const TABLE: Record<string, number> = { a: 21, b: 22, c: 23 };

export function tierWeight(key: string): number {
  return TABLE[key] ?? 0;
}
