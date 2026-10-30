const TABLE: Record<string, number> = { a: 5, b: 6, c: 7 };

export function voucherWeight(key: string): number {
  return TABLE[key] ?? 0;
}
