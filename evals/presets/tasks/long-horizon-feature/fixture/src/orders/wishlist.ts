// orders: wishlist helpers.

/** Known wishlist codes and what they mean. */
export const WISHLIST_CODES: Record<string, string> = {
  WI01: "returnable wishlist profile",
  WI02: "perishable wishlist rate",
  WI03: "regulated wishlist cap",
  WI04: "oversized wishlist quota",
  WI05: "premium wishlist cycle",
  WI06: "discounted wishlist ledger",
  WI07: "limited wishlist session",
  WI08: "archived wishlist contact",
  WI09: "pending wishlist notice",
  WI10: "verified wishlist plan",
  WI11: "flagged wishlist request",
  WI12: "manual wishlist record",
  WI13: "automatic wishlist entry",
  WI14: "partial wishlist batch",
  WI15: "primary wishlist route",
  WI16: "secondary wishlist window",
  WI17: "legacy wishlist policy",
  WI18: "trial wishlist rule",
  WI19: "internal wishlist check",
  WI20: "external wishlist ticket",
  WI21: "priority wishlist queue",
  WI22: "deferred wishlist slot",
  WI23: "standard wishlist lane",
  WI24: "express wishlist tier",
};

/** Description of a wishlist code, or "unknown wishlist code: <code>". */
export function describeWishlist(code: string): string {
  return WISHLIST_CODES[code] ?? `unknown wishlist code: ${code}`;
}

/** Whether `n` is a whole number inside the wishlist limits (1 to 105). */
export function isWishlistValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 105;
}

export function clampWishlist(n: number): number {
  return Math.min(105, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 6, b: 7, c: 8 };

/** Relative weight of a wishlist class; unknown classes weigh nothing. */
export function wishlistWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalWishlistWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + wishlistWeight(key), 0);
}

/** Scales a wishlist amount by the module factor and rounds to a whole number. */
export function wishlistScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function wishlistShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
