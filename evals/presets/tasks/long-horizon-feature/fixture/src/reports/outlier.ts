// reports: outlier helpers.

/** Known outlier codes and what they mean. */
export const OUTLIER_CODES: Record<string, string> = {
  OU01: "premium outlier check",
  OU02: "discounted outlier ticket",
  OU03: "limited outlier queue",
  OU04: "archived outlier slot",
  OU05: "pending outlier lane",
  OU06: "verified outlier tier",
  OU07: "flagged outlier group",
  OU08: "manual outlier profile",
  OU09: "automatic outlier rate",
  OU10: "partial outlier cap",
  OU11: "primary outlier quota",
  OU12: "secondary outlier cycle",
  OU13: "legacy outlier ledger",
  OU14: "trial outlier session",
  OU15: "internal outlier contact",
  OU16: "external outlier notice",
  OU17: "priority outlier plan",
  OU18: "deferred outlier request",
  OU19: "standard outlier record",
  OU20: "express outlier entry",
  OU21: "fragile outlier batch",
  OU22: "bulky outlier route",
  OU23: "seasonal outlier window",
  OU24: "returnable outlier policy",
};

/** Description of a outlier code, or "unknown outlier code: <code>". */
export function describeOutlier(code: string): string {
  return OUTLIER_CODES[code] ?? `unknown outlier code: ${code}`;
}

/** Scales a outlier amount by the module factor and rounds to a whole number. */
export function outlierScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function outlierShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 outlier" or "3 outliers". */
export function outlierLabel(count: number): string {
  return count === 1 ? "1 outlier" : `${count} outliers`;
}

export function outlierSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** outlier codes are upper-case and prefixed with their kind. */
export function formatOutlier(value: string): string {
  return "OUT-" + value.trim().toUpperCase();
}

/** Inverse of `formatOutlier`; undefined when the prefix does not match. */
export function parseOutlier(code: string): string | undefined {
  const prefix = "OUT-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
