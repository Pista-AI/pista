const TABLE: Record<string, number> = { a: 30, b: 31, c: 32 };

export function batchWeight(key: string): number {
  return TABLE[key] ?? 0;
}
