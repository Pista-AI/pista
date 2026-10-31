// inventory: cycle helpers.

/** Known cycle codes and what they mean. */
export const CYCLE_CODES: Record<string, string> = {
  CY01: "trial cycle rate",
  CY02: "internal cycle cap",
  CY03: "external cycle quota",
  CY04: "priority cycle cycle",
  CY05: "deferred cycle ledger",
  CY06: "standard cycle session",
  CY07: "express cycle contact",
  CY08: "fragile cycle notice",
  CY09: "bulky cycle plan",
  CY10: "seasonal cycle request",
  CY11: "returnable cycle record",
  CY12: "perishable cycle entry",
  CY13: "regulated cycle batch",
  CY14: "oversized cycle route",
  CY15: "premium cycle window",
  CY16: "discounted cycle policy",
  CY17: "limited cycle rule",
  CY18: "archived cycle check",
  CY19: "pending cycle ticket",
  CY20: "verified cycle queue",
  CY21: "flagged cycle slot",
  CY22: "manual cycle lane",
  CY23: "automatic cycle tier",
  CY24: "partial cycle group",
};

/** Description of a cycle code, or "unknown cycle code: <code>". */
export function describeCycle(code: string): string {
  return CYCLE_CODES[code] ?? `unknown cycle code: ${code}`;
}

/** Whether `n` is a whole number inside the cycle limits (2 to 122). */
export function isCycleValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 122;
}

export function clampCycle(n: number): number {
  return Math.min(122, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 23, b: 24, c: 25 };

/** Relative weight of a cycle class; unknown classes weigh nothing. */
export function cycleWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCycleWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + cycleWeight(key), 0);
}

/** Scales a cycle amount by the module factor and rounds to a whole number. */
export function cycleScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function cycleShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
