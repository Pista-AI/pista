// inventory: ship helpers.

/** Known ship codes and what they mean. */
export const SHIP_CODES: Record<string, string> = {
  SH01: "deferred ship batch",
  SH02: "standard ship route",
  SH03: "express ship window",
  SH04: "fragile ship policy",
  SH05: "bulky ship rule",
  SH06: "seasonal ship check",
  SH07: "returnable ship ticket",
  SH08: "perishable ship queue",
  SH09: "regulated ship slot",
  SH10: "oversized ship lane",
  SH11: "premium ship tier",
  SH12: "discounted ship group",
  SH13: "limited ship profile",
  SH14: "archived ship rate",
  SH15: "pending ship cap",
  SH16: "verified ship quota",
  SH17: "flagged ship cycle",
  SH18: "manual ship ledger",
  SH19: "automatic ship session",
  SH20: "partial ship contact",
  SH21: "primary ship notice",
  SH22: "secondary ship plan",
  SH23: "legacy ship request",
  SH24: "trial ship record",
};

/** Description of a ship code, or "unknown ship code: <code>". */
export function describeShip(code: string): string {
  return SHIP_CODES[code] ?? `unknown ship code: ${code}`;
}

/** ship codes are upper-case and prefixed with their kind. */
export function formatShip(value: string): string {
  return "SHI-" + value.trim().toUpperCase();
}

/** Inverse of `formatShip`; undefined when the prefix does not match. */
export function parseShip(code: string): string | undefined {
  const prefix = "SHI-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the ship limits (2 to 126). */
export function isShipValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 126;
}

export function clampShip(n: number): number {
  return Math.min(126, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 27, b: 28, c: 29 };

/** Relative weight of a ship class; unknown classes weigh nothing. */
export function shipWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalShipWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + shipWeight(key), 0);
}
