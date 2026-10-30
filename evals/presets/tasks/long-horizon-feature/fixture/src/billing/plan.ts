// billing: plan helpers.

/** Known plan codes and what they mean. */
export const PLAN_CODES: Record<string, string> = {
  PL01: "primary plan rule",
  PL02: "secondary plan check",
  PL03: "legacy plan ticket",
  PL04: "trial plan queue",
  PL05: "internal plan slot",
  PL06: "external plan lane",
  PL07: "priority plan tier",
  PL08: "deferred plan group",
  PL09: "standard plan profile",
  PL10: "express plan rate",
  PL11: "fragile plan cap",
  PL12: "bulky plan quota",
  PL13: "seasonal plan cycle",
  PL14: "returnable plan ledger",
  PL15: "perishable plan session",
  PL16: "regulated plan contact",
  PL17: "oversized plan notice",
  PL18: "premium plan plan",
  PL19: "discounted plan request",
  PL20: "limited plan record",
  PL21: "archived plan entry",
  PL22: "pending plan batch",
  PL23: "verified plan route",
  PL24: "flagged plan window",
};

/** Description of a plan code, or "unknown plan code: <code>". */
export function describePlan(code: string): string {
  return PLAN_CODES[code] ?? `unknown plan code: ${code}`;
}

/** Whether `n` is a whole number inside the plan limits (3 to 119). */
export function isPlanValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 119;
}

export function clampPlan(n: number): number {
  return Math.min(119, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 20, b: 21, c: 22 };

/** Relative weight of a plan class; unknown classes weigh nothing. */
export function planWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPlanWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + planWeight(key), 0);
}

/** Scales a plan amount by the module factor and rounds to a whole number. */
export function planScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function planShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
