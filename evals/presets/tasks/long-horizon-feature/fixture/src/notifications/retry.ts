const TABLE: Record<string, number> = { a: 15, b: 16, c: 17 };

export function retryWeight(key: string): number {
  return TABLE[key] ?? 0;
}
