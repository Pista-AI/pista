// inventory: sleeve helpers.

/** Known sleeve codes and what they mean. */
export const SLEEVE_CODES: Record<string, string> = {
  SL01: "discounted sleeve slot",
  SL02: "limited sleeve lane",
  SL03: "archived sleeve tier",
  SL04: "pending sleeve group",
  SL05: "verified sleeve profile",
  SL06: "flagged sleeve rate",
  SL07: "manual sleeve cap",
  SL08: "automatic sleeve quota",
  SL09: "partial sleeve cycle",
  SL10: "primary sleeve ledger",
  SL11: "secondary sleeve session",
  SL12: "legacy sleeve contact",
  SL13: "trial sleeve notice",
  SL14: "internal sleeve plan",
  SL15: "external sleeve request",
  SL16: "priority sleeve record",
  SL17: "deferred sleeve entry",
  SL18: "standard sleeve batch",
  SL19: "express sleeve route",
  SL20: "fragile sleeve window",
  SL21: "bulky sleeve policy",
  SL22: "seasonal sleeve rule",
  SL23: "returnable sleeve check",
  SL24: "perishable sleeve ticket",
};

/** Description of a sleeve code, or "unknown sleeve code: <code>". */
export function describeSleeve(code: string): string {
  return SLEEVE_CODES[code] ?? `unknown sleeve code: ${code}`;
}

/** Whether `n` is a whole number inside the sleeve limits (1 to 137). */
export function isSleeveValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 137;
}

export function clampSleeve(n: number): number {
  return Math.min(137, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 38, b: 39, c: 40 };

/** Relative weight of a sleeve class; unknown classes weigh nothing. */
export function sleeveWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSleeveWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + sleeveWeight(key), 0);
}

/** Scales a sleeve amount by the module factor and rounds to a whole number. */
export function sleeveScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function sleeveShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
