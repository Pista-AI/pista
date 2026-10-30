const TABLE: Record<string, number> = { a: 32, b: 33, c: 34 };

export function referralWeight(key: string): number {
  return TABLE[key] ?? 0;
}
