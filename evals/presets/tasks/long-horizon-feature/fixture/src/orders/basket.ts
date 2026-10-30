// orders: basket helpers.

/** Known basket codes and what they mean. */
export const BASKET_CODES: Record<string, string> = {
  BA01: "returnable basket session",
  BA02: "perishable basket contact",
  BA03: "regulated basket notice",
  BA04: "oversized basket plan",
  BA05: "premium basket request",
  BA06: "discounted basket record",
  BA07: "limited basket entry",
  BA08: "archived basket batch",
  BA09: "pending basket route",
  BA10: "verified basket window",
  BA11: "flagged basket policy",
  BA12: "manual basket rule",
  BA13: "automatic basket check",
  BA14: "partial basket ticket",
  BA15: "primary basket queue",
  BA16: "secondary basket slot",
  BA17: "legacy basket lane",
  BA18: "trial basket tier",
  BA19: "internal basket group",
  BA20: "external basket profile",
  BA21: "priority basket rate",
  BA22: "deferred basket cap",
  BA23: "standard basket quota",
  BA24: "express basket cycle",
};

/** Description of a basket code, or "unknown basket code: <code>". */
export function describeBasket(code: string): string {
  return BASKET_CODES[code] ?? `unknown basket code: ${code}`;
}

/** Scales a basket amount by the module factor and rounds to a whole number. */
export function basketScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function basketShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
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
