// orders: refund helpers.

/** Known refund codes and what they mean. */
export const REFUND_CODES: Record<string, string> = {
  RE01: "flagged refund ledger",
  RE02: "manual refund session",
  RE03: "automatic refund contact",
  RE04: "partial refund notice",
  RE05: "primary refund plan",
  RE06: "secondary refund request",
  RE07: "legacy refund record",
  RE08: "trial refund entry",
  RE09: "internal refund batch",
  RE10: "external refund route",
  RE11: "priority refund window",
  RE12: "deferred refund policy",
  RE13: "standard refund rule",
  RE14: "express refund check",
  RE15: "fragile refund ticket",
  RE16: "bulky refund queue",
  RE17: "seasonal refund slot",
  RE18: "returnable refund lane",
  RE19: "perishable refund tier",
  RE20: "regulated refund group",
  RE21: "oversized refund profile",
  RE22: "premium refund rate",
  RE23: "discounted refund cap",
  RE24: "limited refund quota",
};

/** Description of a refund code, or "unknown refund code: <code>". */
export function describeRefund(code: string): string {
  return REFUND_CODES[code] ?? `unknown refund code: ${code}`;
}

/** Whether `n` is a whole number inside the refund limits (3 to 115). */
export function isRefundValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 115;
}

export function clampRefund(n: number): number {
  return Math.min(115, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 16, b: 17, c: 18 };

/** Relative weight of a refund class; unknown classes weigh nothing. */
export function refundWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalRefundWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + refundWeight(key), 0);
}

/** Scales a refund amount by the module factor and rounds to a whole number. */
export function refundScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function refundShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
