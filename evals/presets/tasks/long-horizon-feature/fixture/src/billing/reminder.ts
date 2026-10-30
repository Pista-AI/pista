const TABLE: Record<string, number> = { a: 16, b: 17, c: 18 };

export function reminderWeight(key: string): number {
  return TABLE[key] ?? 0;
}
