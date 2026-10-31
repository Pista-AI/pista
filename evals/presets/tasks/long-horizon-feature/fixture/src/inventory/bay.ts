// inventory: bay helpers.

/** Known bay codes and what they mean. */
export const BAY_CODES: Record<string, string> = {
  BA01: "manual bay notice",
  BA02: "automatic bay plan",
  BA03: "partial bay request",
  BA04: "primary bay record",
  BA05: "secondary bay entry",
  BA06: "legacy bay batch",
  BA07: "trial bay route",
  BA08: "internal bay window",
  BA09: "external bay policy",
  BA10: "priority bay rule",
  BA11: "deferred bay check",
  BA12: "standard bay ticket",
  BA13: "express bay queue",
  BA14: "fragile bay slot",
  BA15: "bulky bay lane",
  BA16: "seasonal bay tier",
  BA17: "returnable bay group",
  BA18: "perishable bay profile",
  BA19: "regulated bay rate",
  BA20: "oversized bay cap",
  BA21: "premium bay quota",
  BA22: "discounted bay cycle",
  BA23: "limited bay ledger",
  BA24: "archived bay session",
};

/** Description of a bay code, or "unknown bay code: <code>". */
export function describeBay(code: string): string {
  return BAY_CODES[code] ?? `unknown bay code: ${code}`;
}

/** bay codes are upper-case and prefixed with their kind. */
export function formatBay(value: string): string {
  return "BAY-" + value.trim().toUpperCase();
}

/** Inverse of `formatBay`; undefined when the prefix does not match. */
export function parseBay(code: string): string | undefined {
  const prefix = "BAY-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the bay limits (0 to 116). */
export function isBayValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 116;
}

export function clampBay(n: number): number {
  return Math.min(116, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 17, b: 18, c: 19 };

/** Relative weight of a bay class; unknown classes weigh nothing. */
export function bayWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBayWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + bayWeight(key), 0);
}
