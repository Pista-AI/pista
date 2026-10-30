// orders: cart helpers.

/** Known cart codes and what they mean. */
export const CART_CODES: Record<string, string> = {
  CA01: "standard cart request",
  CA02: "express cart record",
  CA03: "fragile cart entry",
  CA04: "bulky cart batch",
  CA05: "seasonal cart route",
  CA06: "returnable cart window",
  CA07: "perishable cart policy",
  CA08: "regulated cart rule",
  CA09: "oversized cart check",
  CA10: "premium cart ticket",
  CA11: "discounted cart queue",
  CA12: "limited cart slot",
  CA13: "archived cart lane",
  CA14: "pending cart tier",
  CA15: "verified cart group",
  CA16: "flagged cart profile",
  CA17: "manual cart rate",
  CA18: "automatic cart cap",
  CA19: "partial cart quota",
  CA20: "primary cart cycle",
  CA21: "secondary cart ledger",
  CA22: "legacy cart session",
  CA23: "trial cart contact",
  CA24: "internal cart notice",
};

/** Description of a cart code, or "unknown cart code: <code>". */
export function describeCart(code: string): string {
  return CART_CODES[code] ?? `unknown cart code: ${code}`;
}

/** Whether `n` is a whole number inside the cart limits (0 to 100). */
export function isCartValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 100;
}

export function clampCart(n: number): number {
  return Math.min(100, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 1, b: 2, c: 3 };

/** Relative weight of a cart class; unknown classes weigh nothing. */
export function cartWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCartWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + cartWeight(key), 0);
}

/** Scales a cart amount by the module factor and rounds to a whole number. */
export function cartScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function cartShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
