// notifications: bounce helpers.

/** Known bounce codes and what they mean. */
export const BOUNCE_CODES: Record<string, string> = {
  BO01: "flagged bounce ledger",
  BO02: "manual bounce session",
  BO03: "automatic bounce contact",
  BO04: "partial bounce notice",
  BO05: "primary bounce plan",
  BO06: "secondary bounce request",
  BO07: "legacy bounce record",
  BO08: "trial bounce entry",
  BO09: "internal bounce batch",
  BO10: "external bounce route",
  BO11: "priority bounce window",
  BO12: "deferred bounce policy",
  BO13: "standard bounce rule",
  BO14: "express bounce check",
  BO15: "fragile bounce ticket",
  BO16: "bulky bounce queue",
  BO17: "seasonal bounce slot",
  BO18: "returnable bounce lane",
  BO19: "perishable bounce tier",
  BO20: "regulated bounce group",
  BO21: "oversized bounce profile",
  BO22: "premium bounce rate",
  BO23: "discounted bounce cap",
  BO24: "limited bounce quota",
};

/** Description of a bounce code, or "unknown bounce code: <code>". */
export function describeBounce(code: string): string {
  return BOUNCE_CODES[code] ?? `unknown bounce code: ${code}`;
}

/** Scales a bounce amount by the module factor and rounds to a whole number. */
export function bounceScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function bounceShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 bounce" or "3 bounces". */
export function bounceLabel(count: number): string {
  return count === 1 ? "1 bounce" : `${count} bounces`;
}

export function bounceSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** bounce codes are upper-case and prefixed with their kind. */
export function formatBounce(value: string): string {
  return "BOU-" + value.trim().toUpperCase();
}

/** Inverse of `formatBounce`; undefined when the prefix does not match. */
export function parseBounce(code: string): string | undefined {
  const prefix = "BOU-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
