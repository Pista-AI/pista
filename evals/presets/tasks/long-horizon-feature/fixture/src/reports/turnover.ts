// reports: turnover helpers.

/** Known turnover codes and what they mean. */
export const TURNOVER_CODES: Record<string, string> = {
  TU01: "fragile turnover lane",
  TU02: "bulky turnover tier",
  TU03: "seasonal turnover group",
  TU04: "returnable turnover profile",
  TU05: "perishable turnover rate",
  TU06: "regulated turnover cap",
  TU07: "oversized turnover quota",
  TU08: "premium turnover cycle",
  TU09: "discounted turnover ledger",
  TU10: "limited turnover session",
  TU11: "archived turnover contact",
  TU12: "pending turnover notice",
  TU13: "verified turnover plan",
  TU14: "flagged turnover request",
  TU15: "manual turnover record",
  TU16: "automatic turnover entry",
  TU17: "partial turnover batch",
  TU18: "primary turnover route",
  TU19: "secondary turnover window",
  TU20: "legacy turnover policy",
  TU21: "trial turnover rule",
  TU22: "internal turnover check",
  TU23: "external turnover ticket",
  TU24: "priority turnover queue",
};

/** Description of a turnover code, or "unknown turnover code: <code>". */
export function describeTurnover(code: string): string {
  return TURNOVER_CODES[code] ?? `unknown turnover code: ${code}`;
}

/** Whether `n` is a whole number inside the turnover limits (1 to 129). */
export function isTurnoverValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 129;
}

export function clampTurnover(n: number): number {
  return Math.min(129, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 30, b: 31, c: 32 };

/** Relative weight of a turnover class; unknown classes weigh nothing. */
export function turnoverWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalTurnoverWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + turnoverWeight(key), 0);
}

/** Scales a turnover amount by the module factor and rounds to a whole number. */
export function turnoverScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function turnoverShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
