// orders: tax helpers.

/** Known tax codes and what they mean. */
export const TAX_CODES: Record<string, string> = {
  TA01: "legacy tax tier",
  TA02: "trial tax group",
  TA03: "internal tax profile",
  TA04: "external tax rate",
  TA05: "priority tax cap",
  TA06: "deferred tax quota",
  TA07: "standard tax cycle",
  TA08: "express tax ledger",
  TA09: "fragile tax session",
  TA10: "bulky tax contact",
  TA11: "seasonal tax notice",
  TA12: "returnable tax plan",
  TA13: "perishable tax request",
  TA14: "regulated tax record",
  TA15: "oversized tax entry",
  TA16: "premium tax batch",
  TA17: "discounted tax route",
  TA18: "limited tax window",
  TA19: "archived tax policy",
  TA20: "pending tax rule",
  TA21: "verified tax check",
  TA22: "flagged tax ticket",
  TA23: "manual tax queue",
  TA24: "automatic tax slot",
};

/** Description of a tax code, or "unknown tax code: <code>". */
export function describeTax(code: string): string {
  return TAX_CODES[code] ?? `unknown tax code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 22, b: 23, c: 24 };

/** Relative weight of a tax class; unknown classes weigh nothing. */
export function taxWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalTaxWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + taxWeight(key), 0);
}

/** Scales a tax amount by the module factor and rounds to a whole number. */
export function taxScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function taxShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 tax" or "3 taxs". */
export function taxLabel(count: number): string {
  return count === 1 ? "1 tax" : `${count} taxs`;
}

export function taxSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
