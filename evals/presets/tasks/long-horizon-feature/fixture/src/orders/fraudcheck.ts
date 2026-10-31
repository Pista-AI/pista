// orders: fraudcheck helpers.

/** Known fraudcheck codes and what they mean. */
export const FRAUDCHECK_CODES: Record<string, string> = {
  FR01: "oversized fraudcheck window",
  FR02: "premium fraudcheck policy",
  FR03: "discounted fraudcheck rule",
  FR04: "limited fraudcheck check",
  FR05: "archived fraudcheck ticket",
  FR06: "pending fraudcheck queue",
  FR07: "verified fraudcheck slot",
  FR08: "flagged fraudcheck lane",
  FR09: "manual fraudcheck tier",
  FR10: "automatic fraudcheck group",
  FR11: "partial fraudcheck profile",
  FR12: "primary fraudcheck rate",
  FR13: "secondary fraudcheck cap",
  FR14: "legacy fraudcheck quota",
  FR15: "trial fraudcheck cycle",
  FR16: "internal fraudcheck ledger",
  FR17: "external fraudcheck session",
  FR18: "priority fraudcheck contact",
  FR19: "deferred fraudcheck notice",
  FR20: "standard fraudcheck plan",
  FR21: "express fraudcheck request",
  FR22: "fragile fraudcheck record",
  FR23: "bulky fraudcheck entry",
  FR24: "seasonal fraudcheck batch",
};

/** Description of a fraudcheck code, or "unknown fraudcheck code: <code>". */
export function describeFraudcheck(code: string): string {
  return FRAUDCHECK_CODES[code] ?? `unknown fraudcheck code: ${code}`;
}

/** Whether `n` is a whole number inside the fraudcheck limits (3 to 135). */
export function isFraudcheckValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 135;
}

export function clampFraudcheck(n: number): number {
  return Math.min(135, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 36, b: 37, c: 38 };

/** Relative weight of a fraudcheck class; unknown classes weigh nothing. */
export function fraudcheckWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalFraudcheckWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + fraudcheckWeight(key), 0);
}

/** Scales a fraudcheck amount by the module factor and rounds to a whole number. */
export function fraudcheckScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function fraudcheckShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
