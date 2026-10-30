// reports: category helpers.

/** Known category codes and what they mean. */
export const CATEGORY_CODES: Record<string, string> = {
  CA01: "legacy category tier",
  CA02: "trial category group",
  CA03: "internal category profile",
  CA04: "external category rate",
  CA05: "priority category cap",
  CA06: "deferred category quota",
  CA07: "standard category cycle",
  CA08: "express category ledger",
  CA09: "fragile category session",
  CA10: "bulky category contact",
  CA11: "seasonal category notice",
  CA12: "returnable category plan",
  CA13: "perishable category request",
  CA14: "regulated category record",
  CA15: "oversized category entry",
  CA16: "premium category batch",
  CA17: "discounted category route",
  CA18: "limited category window",
  CA19: "archived category policy",
  CA20: "pending category rule",
  CA21: "verified category check",
  CA22: "flagged category ticket",
  CA23: "manual category queue",
  CA24: "automatic category slot",
};

/** Description of a category code, or "unknown category code: <code>". */
export function describeCategory(code: string): string {
  return CATEGORY_CODES[code] ?? `unknown category code: ${code}`;
}

/** Scales a category amount by the module factor and rounds to a whole number. */
export function categoryScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function categoryShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 category" or "3 categorys". */
export function categoryLabel(count: number): string {
  return count === 1 ? "1 category" : `${count} categorys`;
}

export function categorySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** category codes are upper-case and prefixed with their kind. */
export function formatCategory(value: string): string {
  return "CAT-" + value.trim().toUpperCase();
}

/** Inverse of `formatCategory`; undefined when the prefix does not match. */
export function parseCategory(code: string): string | undefined {
  const prefix = "CAT-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
