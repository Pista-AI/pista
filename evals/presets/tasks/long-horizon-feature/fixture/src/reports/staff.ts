// reports: staff helpers.

/** Known staff codes and what they mean. */
export const STAFF_CODES: Record<string, string> = {
  ST01: "external staff contact",
  ST02: "priority staff notice",
  ST03: "deferred staff plan",
  ST04: "standard staff request",
  ST05: "express staff record",
  ST06: "fragile staff entry",
  ST07: "bulky staff batch",
  ST08: "seasonal staff route",
  ST09: "returnable staff window",
  ST10: "perishable staff policy",
  ST11: "regulated staff rule",
  ST12: "oversized staff check",
  ST13: "premium staff ticket",
  ST14: "discounted staff queue",
  ST15: "limited staff slot",
  ST16: "archived staff lane",
  ST17: "pending staff tier",
  ST18: "verified staff group",
  ST19: "flagged staff profile",
  ST20: "manual staff rate",
  ST21: "automatic staff cap",
  ST22: "partial staff quota",
  ST23: "primary staff cycle",
  ST24: "secondary staff ledger",
};

/** Description of a staff code, or "unknown staff code: <code>". */
export function describeStaff(code: string): string {
  return STAFF_CODES[code] ?? `unknown staff code: ${code}`;
}

/** Whether `n` is a whole number inside the staff limits (0 to 124). */
export function isStaffValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 124;
}

export function clampStaff(n: number): number {
  return Math.min(124, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 25, b: 26, c: 27 };

/** Relative weight of a staff class; unknown classes weigh nothing. */
export function staffWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalStaffWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + staffWeight(key), 0);
}

/** Scales a staff amount by the module factor and rounds to a whole number. */
export function staffScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function staffShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
