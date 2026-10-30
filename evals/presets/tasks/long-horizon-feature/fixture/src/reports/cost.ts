// reports: cost helpers.

/** Known cost codes and what they mean. */
export const COST_CODES: Record<string, string> = {
  CO01: "limited cost check",
  CO02: "archived cost ticket",
  CO03: "pending cost queue",
  CO04: "verified cost slot",
  CO05: "flagged cost lane",
  CO06: "manual cost tier",
  CO07: "automatic cost group",
  CO08: "partial cost profile",
  CO09: "primary cost rate",
  CO10: "secondary cost cap",
  CO11: "legacy cost quota",
  CO12: "trial cost cycle",
  CO13: "internal cost ledger",
  CO14: "external cost session",
  CO15: "priority cost contact",
  CO16: "deferred cost notice",
  CO17: "standard cost plan",
  CO18: "express cost request",
  CO19: "fragile cost record",
  CO20: "bulky cost entry",
  CO21: "seasonal cost batch",
  CO22: "returnable cost route",
  CO23: "perishable cost window",
  CO24: "regulated cost policy",
};

/** Description of a cost code, or "unknown cost code: <code>". */
export function describeCost(code: string): string {
  return COST_CODES[code] ?? `unknown cost code: ${code}`;
}

/** Scales a cost amount by the module factor and rounds to a whole number. */
export function costScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function costShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 cost" or "3 costs". */
export function costLabel(count: number): string {
  return count === 1 ? "1 cost" : `${count} costs`;
}

export function costSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** cost codes are upper-case and prefixed with their kind. */
export function formatCost(value: string): string {
  return "COS-" + value.trim().toUpperCase();
}

/** Inverse of `formatCost`; undefined when the prefix does not match. */
export function parseCost(code: string): string | undefined {
  const prefix = "COS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
