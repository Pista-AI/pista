const TABLE: Record<string, number> = { a: 20, b: 21, c: 22 };

export function footerWeight(key: string): number {
  return TABLE[key] ?? 0;
}
