// orders: preorder helpers.

/** Known preorder codes and what they mean. */
export const PREORDER_CODES: Record<string, string> = {
  PR01: "partial preorder route",
  PR02: "primary preorder window",
  PR03: "secondary preorder policy",
  PR04: "legacy preorder rule",
  PR05: "trial preorder check",
  PR06: "internal preorder ticket",
  PR07: "external preorder queue",
  PR08: "priority preorder slot",
  PR09: "deferred preorder lane",
  PR10: "standard preorder tier",
  PR11: "express preorder group",
  PR12: "fragile preorder profile",
  PR13: "bulky preorder rate",
  PR14: "seasonal preorder cap",
  PR15: "returnable preorder quota",
  PR16: "perishable preorder cycle",
  PR17: "regulated preorder ledger",
  PR18: "oversized preorder session",
  PR19: "premium preorder contact",
  PR20: "discounted preorder notice",
  PR21: "limited preorder plan",
  PR22: "archived preorder request",
  PR23: "pending preorder record",
  PR24: "verified preorder entry",
};

/** Description of a preorder code, or "unknown preorder code: <code>". */
export function describePreorder(code: string): string {
  return PREORDER_CODES[code] ?? `unknown preorder code: ${code}`;
}

/** "1 preorder" or "3 preorders". */
export function preorderLabel(count: number): string {
  return count === 1 ? "1 preorder" : `${count} preorders`;
}

export function preorderSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** preorder codes are upper-case and prefixed with their kind. */
export function formatPreorder(value: string): string {
  return "PRE-" + value.trim().toUpperCase();
}

/** Inverse of `formatPreorder`; undefined when the prefix does not match. */
export function parsePreorder(code: string): string | undefined {
  const prefix = "PRE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the preorder limits (2 to 118). */
export function isPreorderValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 118;
}

export function clampPreorder(n: number): number {
  return Math.min(118, Math.max(2, Math.trunc(n)));
}
