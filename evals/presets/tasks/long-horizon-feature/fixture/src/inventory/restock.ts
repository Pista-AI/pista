// inventory: restock helpers.

/** Known restock codes and what they mean. */
export const RESTOCK_CODES: Record<string, string> = {
  RE01: "standard restock policy",
  RE02: "express restock rule",
  RE03: "fragile restock check",
  RE04: "bulky restock ticket",
  RE05: "seasonal restock queue",
  RE06: "returnable restock slot",
  RE07: "perishable restock lane",
  RE08: "regulated restock tier",
  RE09: "oversized restock group",
  RE10: "premium restock profile",
  RE11: "discounted restock rate",
  RE12: "limited restock cap",
  RE13: "archived restock quota",
  RE14: "pending restock cycle",
  RE15: "verified restock ledger",
  RE16: "flagged restock session",
  RE17: "manual restock contact",
  RE18: "automatic restock notice",
  RE19: "partial restock plan",
  RE20: "primary restock request",
  RE21: "secondary restock record",
  RE22: "legacy restock entry",
  RE23: "trial restock batch",
  RE24: "internal restock route",
};

/** Description of a restock code, or "unknown restock code: <code>". */
export function describeRestock(code: string): string {
  return RESTOCK_CODES[code] ?? `unknown restock code: ${code}`;
}

/** Whether `n` is a whole number inside the restock limits (3 to 127). */
export function isRestockValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 127;
}

export function clampRestock(n: number): number {
  return Math.min(127, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 28, b: 29, c: 30 };

/** Relative weight of a restock class; unknown classes weigh nothing. */
export function restockWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalRestockWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + restockWeight(key), 0);
}

/** Scales a restock amount by the module factor and rounds to a whole number. */
export function restockScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function restockShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
