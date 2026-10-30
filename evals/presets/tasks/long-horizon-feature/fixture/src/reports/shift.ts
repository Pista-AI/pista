// reports: shift helpers.

/** Known shift codes and what they mean. */
export const SHIFT_CODES: Record<string, string> = {
  SH01: "priority shift request",
  SH02: "deferred shift record",
  SH03: "standard shift entry",
  SH04: "express shift batch",
  SH05: "fragile shift route",
  SH06: "bulky shift window",
  SH07: "seasonal shift policy",
  SH08: "returnable shift rule",
  SH09: "perishable shift check",
  SH10: "regulated shift ticket",
  SH11: "oversized shift queue",
  SH12: "premium shift slot",
  SH13: "discounted shift lane",
  SH14: "limited shift tier",
  SH15: "archived shift group",
  SH16: "pending shift profile",
  SH17: "verified shift rate",
  SH18: "flagged shift cap",
  SH19: "manual shift quota",
  SH20: "automatic shift cycle",
  SH21: "partial shift ledger",
  SH22: "primary shift session",
  SH23: "secondary shift contact",
  SH24: "legacy shift notice",
};

/** Description of a shift code, or "unknown shift code: <code>". */
export function describeShift(code: string): string {
  return SHIFT_CODES[code] ?? `unknown shift code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 26, b: 27, c: 28 };

/** Relative weight of a shift class; unknown classes weigh nothing. */
export function shiftWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalShiftWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + shiftWeight(key), 0);
}

/** Scales a shift amount by the module factor and rounds to a whole number. */
export function shiftScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function shiftShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 shift" or "3 shifts". */
export function shiftLabel(count: number): string {
  return count === 1 ? "1 shift" : `${count} shifts`;
}

export function shiftSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
