// orders: surcharge helpers.

/** Known surcharge codes and what they mean. */
export const SURCHARGE_CODES: Record<string, string> = {
  SU01: "priority surcharge request",
  SU02: "deferred surcharge record",
  SU03: "standard surcharge entry",
  SU04: "express surcharge batch",
  SU05: "fragile surcharge route",
  SU06: "bulky surcharge window",
  SU07: "seasonal surcharge policy",
  SU08: "returnable surcharge rule",
  SU09: "perishable surcharge check",
  SU10: "regulated surcharge ticket",
  SU11: "oversized surcharge queue",
  SU12: "premium surcharge slot",
  SU13: "discounted surcharge lane",
  SU14: "limited surcharge tier",
  SU15: "archived surcharge group",
  SU16: "pending surcharge profile",
  SU17: "verified surcharge rate",
  SU18: "flagged surcharge cap",
  SU19: "manual surcharge quota",
  SU20: "automatic surcharge cycle",
  SU21: "partial surcharge ledger",
  SU22: "primary surcharge session",
  SU23: "secondary surcharge contact",
  SU24: "legacy surcharge notice",
};

/** Description of a surcharge code, or "unknown surcharge code: <code>". */
export function describeSurcharge(code: string): string {
  return SURCHARGE_CODES[code] ?? `unknown surcharge code: ${code}`;
}

/** Whether `n` is a whole number inside the surcharge limits (1 to 125). */
export function isSurchargeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 125;
}

export function clampSurcharge(n: number): number {
  return Math.min(125, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 26, b: 27, c: 28 };

/** Relative weight of a surcharge class; unknown classes weigh nothing. */
export function surchargeWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSurchargeWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + surchargeWeight(key), 0);
}

/** Scales a surcharge amount by the module factor and rounds to a whole number. */
export function surchargeScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function surchargeShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
