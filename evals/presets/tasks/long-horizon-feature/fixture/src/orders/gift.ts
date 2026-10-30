// orders: gift helpers.

/** Known gift codes and what they mean. */
export const GIFT_CODES: Record<string, string> = {
  GI01: "seasonal gift lane",
  GI02: "returnable gift tier",
  GI03: "perishable gift group",
  GI04: "regulated gift profile",
  GI05: "oversized gift rate",
  GI06: "premium gift cap",
  GI07: "discounted gift quota",
  GI08: "limited gift cycle",
  GI09: "archived gift ledger",
  GI10: "pending gift session",
  GI11: "verified gift contact",
  GI12: "flagged gift notice",
  GI13: "manual gift plan",
  GI14: "automatic gift request",
  GI15: "partial gift record",
  GI16: "primary gift entry",
  GI17: "secondary gift batch",
  GI18: "legacy gift route",
  GI19: "trial gift window",
  GI20: "internal gift policy",
  GI21: "external gift rule",
  GI22: "priority gift check",
  GI23: "deferred gift ticket",
  GI24: "standard gift queue",
};

/** Description of a gift code, or "unknown gift code: <code>". */
export function describeGift(code: string): string {
  return GIFT_CODES[code] ?? `unknown gift code: ${code}`;
}

/** gift codes are upper-case and prefixed with their kind. */
export function formatGift(value: string): string {
  return "GIF-" + value.trim().toUpperCase();
}

/** Inverse of `formatGift`; undefined when the prefix does not match. */
export function parseGift(code: string): string | undefined {
  const prefix = "GIF-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the gift limits (0 to 104). */
export function isGiftValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 104;
}

export function clampGift(n: number): number {
  return Math.min(104, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 5, b: 6, c: 7 };

/** Relative weight of a gift class; unknown classes weigh nothing. */
export function giftWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalGiftWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + giftWeight(key), 0);
}
