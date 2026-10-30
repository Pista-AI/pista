// inventory: shelf helpers.

/** Known shelf codes and what they mean. */
export const SHELF_CODES: Record<string, string> = {
  SH01: "fragile shelf policy",
  SH02: "bulky shelf rule",
  SH03: "seasonal shelf check",
  SH04: "returnable shelf ticket",
  SH05: "perishable shelf queue",
  SH06: "regulated shelf slot",
  SH07: "oversized shelf lane",
  SH08: "premium shelf tier",
  SH09: "discounted shelf group",
  SH10: "limited shelf profile",
  SH11: "archived shelf rate",
  SH12: "pending shelf cap",
  SH13: "verified shelf quota",
  SH14: "flagged shelf cycle",
  SH15: "manual shelf ledger",
  SH16: "automatic shelf session",
  SH17: "partial shelf contact",
  SH18: "primary shelf notice",
  SH19: "secondary shelf plan",
  SH20: "legacy shelf request",
  SH21: "trial shelf record",
  SH22: "internal shelf entry",
  SH23: "external shelf batch",
  SH24: "priority shelf route",
};

/** Description of a shelf code, or "unknown shelf code: <code>". */
export function describeShelf(code: string): string {
  return SHELF_CODES[code] ?? `unknown shelf code: ${code}`;
}

/** Whether `n` is a whole number inside the shelf limits (2 to 102). */
export function isShelfValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 102;
}

export function clampShelf(n: number): number {
  return Math.min(102, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 3, b: 4, c: 5 };

/** Relative weight of a shelf class; unknown classes weigh nothing. */
export function shelfWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalShelfWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + shelfWeight(key), 0);
}

/** Scales a shelf amount by the module factor and rounds to a whole number. */
export function shelfScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function shelfShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
