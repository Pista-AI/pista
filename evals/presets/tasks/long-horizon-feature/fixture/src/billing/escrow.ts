// billing: escrow helpers.

/** Known escrow codes and what they mean. */
export const ESCROW_CODES: Record<string, string> = {
  ES01: "regulated escrow entry",
  ES02: "oversized escrow batch",
  ES03: "premium escrow route",
  ES04: "discounted escrow window",
  ES05: "limited escrow policy",
  ES06: "archived escrow rule",
  ES07: "pending escrow check",
  ES08: "verified escrow ticket",
  ES09: "flagged escrow queue",
  ES10: "manual escrow slot",
  ES11: "automatic escrow lane",
  ES12: "partial escrow tier",
  ES13: "primary escrow group",
  ES14: "secondary escrow profile",
  ES15: "legacy escrow rate",
  ES16: "trial escrow cap",
  ES17: "internal escrow quota",
  ES18: "external escrow cycle",
  ES19: "priority escrow ledger",
  ES20: "deferred escrow session",
  ES21: "standard escrow contact",
  ES22: "express escrow notice",
  ES23: "fragile escrow plan",
  ES24: "bulky escrow request",
};

/** Description of a escrow code, or "unknown escrow code: <code>". */
export function describeEscrow(code: string): string {
  return ESCROW_CODES[code] ?? `unknown escrow code: ${code}`;
}

/** Whether `n` is a whole number inside the escrow limits (2 to 134). */
export function isEscrowValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 134;
}

export function clampEscrow(n: number): number {
  return Math.min(134, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 35, b: 36, c: 37 };

/** Relative weight of a escrow class; unknown classes weigh nothing. */
export function escrowWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalEscrowWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + escrowWeight(key), 0);
}

/** Scales a escrow amount by the module factor and rounds to a whole number. */
export function escrowScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function escrowShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
