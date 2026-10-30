// billing: pause helpers.

/** Known pause codes and what they mean. */
export const PAUSE_CODES: Record<string, string> = {
  PA01: "external pause contact",
  PA02: "priority pause notice",
  PA03: "deferred pause plan",
  PA04: "standard pause request",
  PA05: "express pause record",
  PA06: "fragile pause entry",
  PA07: "bulky pause batch",
  PA08: "seasonal pause route",
  PA09: "returnable pause window",
  PA10: "perishable pause policy",
  PA11: "regulated pause rule",
  PA12: "oversized pause check",
  PA13: "premium pause ticket",
  PA14: "discounted pause queue",
  PA15: "limited pause slot",
  PA16: "archived pause lane",
  PA17: "pending pause tier",
  PA18: "verified pause group",
  PA19: "flagged pause profile",
  PA20: "manual pause rate",
  PA21: "automatic pause cap",
  PA22: "partial pause quota",
  PA23: "primary pause cycle",
  PA24: "secondary pause ledger",
};

/** Description of a pause code, or "unknown pause code: <code>". */
export function describePause(code: string): string {
  return PAUSE_CODES[code] ?? `unknown pause code: ${code}`;
}

/** Whether `n` is a whole number inside the pause limits (0 to 124). */
export function isPauseValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 124;
}

export function clampPause(n: number): number {
  return Math.min(124, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 25, b: 26, c: 27 };

/** Relative weight of a pause class; unknown classes weigh nothing. */
export function pauseWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPauseWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + pauseWeight(key), 0);
}

/** Scales a pause amount by the module factor and rounds to a whole number. */
export function pauseScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function pauseShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
