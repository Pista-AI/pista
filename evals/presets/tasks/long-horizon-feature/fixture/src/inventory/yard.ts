// inventory: yard helpers.

/** Known yard codes and what they mean. */
export const YARD_CODES: Record<string, string> = {
  YA01: "returnable yard session",
  YA02: "perishable yard contact",
  YA03: "regulated yard notice",
  YA04: "oversized yard plan",
  YA05: "premium yard request",
  YA06: "discounted yard record",
  YA07: "limited yard entry",
  YA08: "archived yard batch",
  YA09: "pending yard route",
  YA10: "verified yard window",
  YA11: "flagged yard policy",
  YA12: "manual yard rule",
  YA13: "automatic yard check",
  YA14: "partial yard ticket",
  YA15: "primary yard queue",
  YA16: "secondary yard slot",
  YA17: "legacy yard lane",
  YA18: "trial yard tier",
  YA19: "internal yard group",
  YA20: "external yard profile",
  YA21: "priority yard rate",
  YA22: "deferred yard cap",
  YA23: "standard yard quota",
  YA24: "express yard cycle",
};

/** Description of a yard code, or "unknown yard code: <code>". */
export function describeYard(code: string): string {
  return YARD_CODES[code] ?? `unknown yard code: ${code}`;
}

/** Whether `n` is a whole number inside the yard limits (0 to 132). */
export function isYardValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 132;
}

export function clampYard(n: number): number {
  return Math.min(132, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 33, b: 34, c: 35 };

/** Relative weight of a yard class; unknown classes weigh nothing. */
export function yardWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalYardWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + yardWeight(key), 0);
}

/** Scales a yard amount by the module factor and rounds to a whole number. */
export function yardScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function yardShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
