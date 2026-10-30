// reports: median helpers.

/** Known median codes and what they mean. */
export const MEDIAN_CODES: Record<string, string> = {
  ME01: "verified median cap",
  ME02: "flagged median quota",
  ME03: "manual median cycle",
  ME04: "automatic median ledger",
  ME05: "partial median session",
  ME06: "primary median contact",
  ME07: "secondary median notice",
  ME08: "legacy median plan",
  ME09: "trial median request",
  ME10: "internal median record",
  ME11: "external median entry",
  ME12: "priority median batch",
  ME13: "deferred median route",
  ME14: "standard median window",
  ME15: "express median policy",
  ME16: "fragile median rule",
  ME17: "bulky median check",
  ME18: "seasonal median ticket",
  ME19: "returnable median queue",
  ME20: "perishable median slot",
  ME21: "regulated median lane",
  ME22: "oversized median tier",
  ME23: "premium median group",
  ME24: "discounted median profile",
};

/** Description of a median code, or "unknown median code: <code>". */
export function describeMedian(code: string): string {
  return MEDIAN_CODES[code] ?? `unknown median code: ${code}`;
}

/** Whether `n` is a whole number inside the median limits (2 to 114). */
export function isMedianValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 114;
}

export function clampMedian(n: number): number {
  return Math.min(114, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 15, b: 16, c: 17 };

/** Relative weight of a median class; unknown classes weigh nothing. */
export function medianWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalMedianWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + medianWeight(key), 0);
}

/** Scales a median amount by the module factor and rounds to a whole number. */
export function medianScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function medianShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
