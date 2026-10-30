// billing: charge helpers.

/** Known charge codes and what they mean. */
export const CHARGE_CODES: Record<string, string> = {
  CH01: "seasonal charge lane",
  CH02: "returnable charge tier",
  CH03: "perishable charge group",
  CH04: "regulated charge profile",
  CH05: "oversized charge rate",
  CH06: "premium charge cap",
  CH07: "discounted charge quota",
  CH08: "limited charge cycle",
  CH09: "archived charge ledger",
  CH10: "pending charge session",
  CH11: "verified charge contact",
  CH12: "flagged charge notice",
  CH13: "manual charge plan",
  CH14: "automatic charge request",
  CH15: "partial charge record",
  CH16: "primary charge entry",
  CH17: "secondary charge batch",
  CH18: "legacy charge route",
  CH19: "trial charge window",
  CH20: "internal charge policy",
  CH21: "external charge rule",
  CH22: "priority charge check",
  CH23: "deferred charge ticket",
  CH24: "standard charge queue",
};

/** Description of a charge code, or "unknown charge code: <code>". */
export function describeCharge(code: string): string {
  return CHARGE_CODES[code] ?? `unknown charge code: ${code}`;
}

/** Whether `n` is a whole number inside the charge limits (0 to 104). */
export function isChargeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 104;
}

export function clampCharge(n: number): number {
  return Math.min(104, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 5, b: 6, c: 7 };

/** Relative weight of a charge class; unknown classes weigh nothing. */
export function chargeWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalChargeWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + chargeWeight(key), 0);
}

/** Scales a charge amount by the module factor and rounds to a whole number. */
export function chargeScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function chargeShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
