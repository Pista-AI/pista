// reports: margin helpers.

/** Known margin codes and what they mean. */
export const MARGIN_CODES: Record<string, string> = {
  MA01: "premium margin entry",
  MA02: "discounted margin batch",
  MA03: "limited margin route",
  MA04: "archived margin window",
  MA05: "pending margin policy",
  MA06: "verified margin rule",
  MA07: "flagged margin check",
  MA08: "manual margin ticket",
  MA09: "automatic margin queue",
  MA10: "partial margin slot",
  MA11: "primary margin lane",
  MA12: "secondary margin tier",
  MA13: "legacy margin group",
  MA14: "trial margin profile",
  MA15: "internal margin rate",
  MA16: "external margin cap",
  MA17: "priority margin quota",
  MA18: "deferred margin cycle",
  MA19: "standard margin ledger",
  MA20: "express margin session",
  MA21: "fragile margin contact",
  MA22: "bulky margin notice",
  MA23: "seasonal margin plan",
  MA24: "returnable margin request",
};

/** Description of a margin code, or "unknown margin code: <code>". */
export function describeMargin(code: string): string {
  return MARGIN_CODES[code] ?? `unknown margin code: ${code}`;
}

/** Whether `n` is a whole number inside the margin limits (1 to 109). */
export function isMarginValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 109;
}

export function clampMargin(n: number): number {
  return Math.min(109, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 10, b: 11, c: 12 };

/** Relative weight of a margin class; unknown classes weigh nothing. */
export function marginWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalMarginWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + marginWeight(key), 0);
}

/** Scales a margin amount by the module factor and rounds to a whole number. */
export function marginScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function marginShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
