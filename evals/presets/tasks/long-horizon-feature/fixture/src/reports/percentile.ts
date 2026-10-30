// reports: percentile helpers.

/** Known percentile codes and what they mean. */
export const PERCENTILE_CODES: Record<string, string> = {
  PE01: "flagged percentile ledger",
  PE02: "manual percentile session",
  PE03: "automatic percentile contact",
  PE04: "partial percentile notice",
  PE05: "primary percentile plan",
  PE06: "secondary percentile request",
  PE07: "legacy percentile record",
  PE08: "trial percentile entry",
  PE09: "internal percentile batch",
  PE10: "external percentile route",
  PE11: "priority percentile window",
  PE12: "deferred percentile policy",
  PE13: "standard percentile rule",
  PE14: "express percentile check",
  PE15: "fragile percentile ticket",
  PE16: "bulky percentile queue",
  PE17: "seasonal percentile slot",
  PE18: "returnable percentile lane",
  PE19: "perishable percentile tier",
  PE20: "regulated percentile group",
  PE21: "oversized percentile profile",
  PE22: "premium percentile rate",
  PE23: "discounted percentile cap",
  PE24: "limited percentile quota",
};

/** Description of a percentile code, or "unknown percentile code: <code>". */
export function describePercentile(code: string): string {
  return PERCENTILE_CODES[code] ?? `unknown percentile code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 16, b: 17, c: 18 };

/** Relative weight of a percentile class; unknown classes weigh nothing. */
export function percentileWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPercentileWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + percentileWeight(key), 0);
}

/** Scales a percentile amount by the module factor and rounds to a whole number. */
export function percentileScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function percentileShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 percentile" or "3 percentiles". */
export function percentileLabel(count: number): string {
  return count === 1 ? "1 percentile" : `${count} percentiles`;
}

export function percentileSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
