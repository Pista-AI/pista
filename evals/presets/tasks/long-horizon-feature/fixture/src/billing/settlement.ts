// billing: settlement helpers.

/** Known settlement codes and what they mean. */
export const SETTLEMENT_CODES: Record<string, string> = {
  SE01: "premium settlement entry",
  SE02: "discounted settlement batch",
  SE03: "limited settlement route",
  SE04: "archived settlement window",
  SE05: "pending settlement policy",
  SE06: "verified settlement rule",
  SE07: "flagged settlement check",
  SE08: "manual settlement ticket",
  SE09: "automatic settlement queue",
  SE10: "partial settlement slot",
  SE11: "primary settlement lane",
  SE12: "secondary settlement tier",
  SE13: "legacy settlement group",
  SE14: "trial settlement profile",
  SE15: "internal settlement rate",
  SE16: "external settlement cap",
  SE17: "priority settlement quota",
  SE18: "deferred settlement cycle",
  SE19: "standard settlement ledger",
  SE20: "express settlement session",
  SE21: "fragile settlement contact",
  SE22: "bulky settlement notice",
  SE23: "seasonal settlement plan",
  SE24: "returnable settlement request",
};

/** Description of a settlement code, or "unknown settlement code: <code>". */
export function describeSettlement(code: string): string {
  return SETTLEMENT_CODES[code] ?? `unknown settlement code: ${code}`;
}

/** Whether `n` is a whole number inside the settlement limits (1 to 109). */
export function isSettlementValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 109;
}

export function clampSettlement(n: number): number {
  return Math.min(109, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 10, b: 11, c: 12 };

/** Relative weight of a settlement class; unknown classes weigh nothing. */
export function settlementWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSettlementWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + settlementWeight(key), 0);
}

/** Scales a settlement amount by the module factor and rounds to a whole number. */
export function settlementScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function settlementShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
