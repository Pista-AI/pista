const TABLE: Record<string, number> = { a: 31, b: 32, c: 33 };

export function fraudWeight(key: string): number {
  return TABLE[key] ?? 0;
}
