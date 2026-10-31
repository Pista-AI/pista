const TABLE: Record<string, number> = { a: 9, b: 10, c: 11 };

export function avatarWeight(key: string): number {
  return TABLE[key] ?? 0;
}
