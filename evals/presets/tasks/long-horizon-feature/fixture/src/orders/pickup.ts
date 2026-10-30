const TABLE: Record<string, number> = { a: 12, b: 13, c: 14 };

export function pickupWeight(key: string): number {
  return TABLE[key] ?? 0;
}
