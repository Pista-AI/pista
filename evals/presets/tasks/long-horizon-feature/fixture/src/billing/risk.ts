// billing: risk helpers.

/** Known risk codes and what they mean. */
export const RISK_CODES: Record<string, string> = {
  RI01: "fragile risk lane",
  RI02: "bulky risk tier",
  RI03: "seasonal risk group",
  RI04: "returnable risk profile",
  RI05: "perishable risk rate",
  RI06: "regulated risk cap",
  RI07: "oversized risk quota",
  RI08: "premium risk cycle",
  RI09: "discounted risk ledger",
  RI10: "limited risk session",
  RI11: "archived risk contact",
  RI12: "pending risk notice",
  RI13: "verified risk plan",
  RI14: "flagged risk request",
  RI15: "manual risk record",
  RI16: "automatic risk entry",
  RI17: "partial risk batch",
  RI18: "primary risk route",
  RI19: "secondary risk window",
  RI20: "legacy risk policy",
  RI21: "trial risk rule",
  RI22: "internal risk check",
  RI23: "external risk ticket",
  RI24: "priority risk queue",
};

/** Description of a risk code, or "unknown risk code: <code>". */
export function describeRisk(code: string): string {
  return RISK_CODES[code] ?? `unknown risk code: ${code}`;
}

/** Whether `n` is a whole number inside the risk limits (1 to 129). */
export function isRiskValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 129;
}

export function clampRisk(n: number): number {
  return Math.min(129, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 30, b: 31, c: 32 };

/** Relative weight of a risk class; unknown classes weigh nothing. */
export function riskWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalRiskWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + riskWeight(key), 0);
}

/** Scales a risk amount by the module factor and rounds to a whole number. */
export function riskScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function riskShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
