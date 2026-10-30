// reports: basket helpers.

/** Known basket codes and what they mean. */
export const BASKET_CODES: Record<string, string> = {
  BA01: "archived basket slot",
  BA02: "pending basket lane",
  BA03: "verified basket tier",
  BA04: "flagged basket group",
  BA05: "manual basket profile",
  BA06: "automatic basket rate",
  BA07: "partial basket cap",
  BA08: "primary basket quota",
  BA09: "secondary basket cycle",
  BA10: "legacy basket ledger",
  BA11: "trial basket session",
  BA12: "internal basket contact",
  BA13: "external basket notice",
  BA14: "priority basket plan",
  BA15: "deferred basket request",
  BA16: "standard basket record",
  BA17: "express basket entry",
  BA18: "fragile basket batch",
  BA19: "bulky basket route",
  BA20: "seasonal basket window",
  BA21: "returnable basket policy",
  BA22: "perishable basket rule",
  BA23: "regulated basket check",
  BA24: "oversized basket ticket",
};

/** Description of a basket code, or "unknown basket code: <code>". */
export function describeBasket(code: string): string {
  return BASKET_CODES[code] ?? `unknown basket code: ${code}`;
}

/** "1 basket" or "3 baskets". */
export function basketLabel(count: number): string {
  return count === 1 ? "1 basket" : `${count} baskets`;
}

export function basketSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** basket codes are upper-case and prefixed with their kind. */
export function formatBasket(value: string): string {
  return "BAS-" + value.trim().toUpperCase();
}

/** Inverse of `formatBasket`; undefined when the prefix does not match. */
export function parseBasket(code: string): string | undefined {
  const prefix = "BAS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the basket limits (0 to 112). */
export function isBasketValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 112;
}

export function clampBasket(n: number): number {
  return Math.min(112, Math.max(0, Math.trunc(n)));
}
