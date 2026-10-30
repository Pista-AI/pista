// notifications: badge helpers.

/** Known badge codes and what they mean. */
export const BADGE_CODES: Record<string, string> = {
  BA01: "perishable badge plan",
  BA02: "regulated badge request",
  BA03: "oversized badge record",
  BA04: "premium badge entry",
  BA05: "discounted badge batch",
  BA06: "limited badge route",
  BA07: "archived badge window",
  BA08: "pending badge policy",
  BA09: "verified badge rule",
  BA10: "flagged badge check",
  BA11: "manual badge ticket",
  BA12: "automatic badge queue",
  BA13: "partial badge slot",
  BA14: "primary badge lane",
  BA15: "secondary badge tier",
  BA16: "legacy badge group",
  BA17: "trial badge profile",
  BA18: "internal badge rate",
  BA19: "external badge cap",
  BA20: "priority badge quota",
  BA21: "deferred badge cycle",
  BA22: "standard badge ledger",
  BA23: "express badge session",
  BA24: "fragile badge contact",
};

/** Description of a badge code, or "unknown badge code: <code>". */
export function describeBadge(code: string): string {
  return BADGE_CODES[code] ?? `unknown badge code: ${code}`;
}

/** Whether `n` is a whole number inside the badge limits (1 to 133). */
export function isBadgeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 133;
}

export function clampBadge(n: number): number {
  return Math.min(133, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 34, b: 35, c: 36 };

/** Relative weight of a badge class; unknown classes weigh nothing. */
export function badgeWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBadgeWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + badgeWeight(key), 0);
}

/** Scales a badge amount by the module factor and rounds to a whole number. */
export function badgeScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function badgeShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
