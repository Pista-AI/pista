// reports: yearly helpers.

/** Known yearly codes and what they mean. */
export const YEARLY_CODES: Record<string, string> = {
  YE01: "seasonal yearly lane",
  YE02: "returnable yearly tier",
  YE03: "perishable yearly group",
  YE04: "regulated yearly profile",
  YE05: "oversized yearly rate",
  YE06: "premium yearly cap",
  YE07: "discounted yearly quota",
  YE08: "limited yearly cycle",
  YE09: "archived yearly ledger",
  YE10: "pending yearly session",
  YE11: "verified yearly contact",
  YE12: "flagged yearly notice",
  YE13: "manual yearly plan",
  YE14: "automatic yearly request",
  YE15: "partial yearly record",
  YE16: "primary yearly entry",
  YE17: "secondary yearly batch",
  YE18: "legacy yearly route",
  YE19: "trial yearly window",
  YE20: "internal yearly policy",
  YE21: "external yearly rule",
  YE22: "priority yearly check",
  YE23: "deferred yearly ticket",
  YE24: "standard yearly queue",
};

/** Description of a yearly code, or "unknown yearly code: <code>". */
export function describeYearly(code: string): string {
  return YEARLY_CODES[code] ?? `unknown yearly code: ${code}`;
}

/** Whether `n` is a whole number inside the yearly limits (0 to 104). */
export function isYearlyValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 104;
}

export function clampYearly(n: number): number {
  return Math.min(104, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 5, b: 6, c: 7 };

/** Relative weight of a yearly class; unknown classes weigh nothing. */
export function yearlyWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalYearlyWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + yearlyWeight(key), 0);
}

/** Scales a yearly amount by the module factor and rounds to a whole number. */
export function yearlyScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function yearlyShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
