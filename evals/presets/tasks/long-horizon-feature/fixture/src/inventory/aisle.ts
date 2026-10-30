// inventory: aisle helpers.

/** Known aisle codes and what they mean. */
export const AISLE_CODES: Record<string, string> = {
  AI01: "seasonal aisle lane",
  AI02: "returnable aisle tier",
  AI03: "perishable aisle group",
  AI04: "regulated aisle profile",
  AI05: "oversized aisle rate",
  AI06: "premium aisle cap",
  AI07: "discounted aisle quota",
  AI08: "limited aisle cycle",
  AI09: "archived aisle ledger",
  AI10: "pending aisle session",
  AI11: "verified aisle contact",
  AI12: "flagged aisle notice",
  AI13: "manual aisle plan",
  AI14: "automatic aisle request",
  AI15: "partial aisle record",
  AI16: "primary aisle entry",
  AI17: "secondary aisle batch",
  AI18: "legacy aisle route",
  AI19: "trial aisle window",
  AI20: "internal aisle policy",
  AI21: "external aisle rule",
  AI22: "priority aisle check",
  AI23: "deferred aisle ticket",
  AI24: "standard aisle queue",
};

/** Description of a aisle code, or "unknown aisle code: <code>". */
export function describeAisle(code: string): string {
  return AISLE_CODES[code] ?? `unknown aisle code: ${code}`;
}

/** Scales a aisle amount by the module factor and rounds to a whole number. */
export function aisleScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function aisleShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 aisle" or "3 aisles". */
export function aisleLabel(count: number): string {
  return count === 1 ? "1 aisle" : `${count} aisles`;
}

export function aisleSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** aisle codes are upper-case and prefixed with their kind. */
export function formatAisle(value: string): string {
  return "AIS-" + value.trim().toUpperCase();
}

/** Inverse of `formatAisle`; undefined when the prefix does not match. */
export function parseAisle(code: string): string | undefined {
  const prefix = "AIS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
