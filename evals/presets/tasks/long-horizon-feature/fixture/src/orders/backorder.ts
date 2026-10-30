// orders: backorder helpers.

/** Known backorder codes and what they mean. */
export const BACKORDER_CODES: Record<string, string> = {
  BA01: "automatic backorder record",
  BA02: "partial backorder entry",
  BA03: "primary backorder batch",
  BA04: "secondary backorder route",
  BA05: "legacy backorder window",
  BA06: "trial backorder policy",
  BA07: "internal backorder rule",
  BA08: "external backorder check",
  BA09: "priority backorder ticket",
  BA10: "deferred backorder queue",
  BA11: "standard backorder slot",
  BA12: "express backorder lane",
  BA13: "fragile backorder tier",
  BA14: "bulky backorder group",
  BA15: "seasonal backorder profile",
  BA16: "returnable backorder rate",
  BA17: "perishable backorder cap",
  BA18: "regulated backorder quota",
  BA19: "oversized backorder cycle",
  BA20: "premium backorder ledger",
  BA21: "discounted backorder session",
  BA22: "limited backorder contact",
  BA23: "archived backorder notice",
  BA24: "pending backorder plan",
};

/** Description of a backorder code, or "unknown backorder code: <code>". */
export function describeBackorder(code: string): string {
  return BACKORDER_CODES[code] ?? `unknown backorder code: ${code}`;
}

/** Scales a backorder amount by the module factor and rounds to a whole number. */
export function backorderScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function backorderShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 backorder" or "3 backorders". */
export function backorderLabel(count: number): string {
  return count === 1 ? "1 backorder" : `${count} backorders`;
}

export function backorderSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** backorder codes are upper-case and prefixed with their kind. */
export function formatBackorder(value: string): string {
  return "BAC-" + value.trim().toUpperCase();
}

/** Inverse of `formatBackorder`; undefined when the prefix does not match. */
export function parseBackorder(code: string): string | undefined {
  const prefix = "BAC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
