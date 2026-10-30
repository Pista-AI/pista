// inventory: carton helpers.

/** Known carton codes and what they mean. */
export const CARTON_CODES: Record<string, string> = {
  CA01: "archived carton slot",
  CA02: "pending carton lane",
  CA03: "verified carton tier",
  CA04: "flagged carton group",
  CA05: "manual carton profile",
  CA06: "automatic carton rate",
  CA07: "partial carton cap",
  CA08: "primary carton quota",
  CA09: "secondary carton cycle",
  CA10: "legacy carton ledger",
  CA11: "trial carton session",
  CA12: "internal carton contact",
  CA13: "external carton notice",
  CA14: "priority carton plan",
  CA15: "deferred carton request",
  CA16: "standard carton record",
  CA17: "express carton entry",
  CA18: "fragile carton batch",
  CA19: "bulky carton route",
  CA20: "seasonal carton window",
  CA21: "returnable carton policy",
  CA22: "perishable carton rule",
  CA23: "regulated carton check",
  CA24: "oversized carton ticket",
};

/** Description of a carton code, or "unknown carton code: <code>". */
export function describeCarton(code: string): string {
  return CARTON_CODES[code] ?? `unknown carton code: ${code}`;
}

/** Whether `n` is a whole number inside the carton limits (0 to 112). */
export function isCartonValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 112;
}

export function clampCarton(n: number): number {
  return Math.min(112, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 13, b: 14, c: 15 };

/** Relative weight of a carton class; unknown classes weigh nothing. */
export function cartonWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCartonWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + cartonWeight(key), 0);
}

/** Scales a carton amount by the module factor and rounds to a whole number. */
export function cartonScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function cartonShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
