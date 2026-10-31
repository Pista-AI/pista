// reports: revenue helpers.

/** Known revenue codes and what they mean. */
export const REVENUE_CODES: Record<string, string> = {
  RE01: "discounted revenue window",
  RE02: "limited revenue policy",
  RE03: "archived revenue rule",
  RE04: "pending revenue check",
  RE05: "verified revenue ticket",
  RE06: "flagged revenue queue",
  RE07: "manual revenue slot",
  RE08: "automatic revenue lane",
  RE09: "partial revenue tier",
  RE10: "primary revenue group",
  RE11: "secondary revenue profile",
  RE12: "legacy revenue rate",
  RE13: "trial revenue cap",
  RE14: "internal revenue quota",
  RE15: "external revenue cycle",
  RE16: "priority revenue ledger",
  RE17: "deferred revenue session",
  RE18: "standard revenue contact",
  RE19: "express revenue notice",
  RE20: "fragile revenue plan",
  RE21: "bulky revenue request",
  RE22: "seasonal revenue record",
  RE23: "returnable revenue entry",
  RE24: "perishable revenue batch",
};

/** Description of a revenue code, or "unknown revenue code: <code>". */
export function describeRevenue(code: string): string {
  return REVENUE_CODES[code] ?? `unknown revenue code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 11, b: 12, c: 13 };

/** Relative weight of a revenue class; unknown classes weigh nothing. */
export function revenueWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalRevenueWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + revenueWeight(key), 0);
}

/** Scales a revenue amount by the module factor and rounds to a whole number. */
export function revenueScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function revenueShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 revenue" or "3 revenues". */
export function revenueLabel(count: number): string {
  return count === 1 ? "1 revenue" : `${count} revenues`;
}

export function revenueSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
