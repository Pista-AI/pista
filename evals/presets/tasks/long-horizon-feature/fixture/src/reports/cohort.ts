// reports: cohort helpers.

/** Known cohort codes and what they mean. */
export const COHORT_CODES: Record<string, string> = {
  CO01: "returnable cohort profile",
  CO02: "perishable cohort rate",
  CO03: "regulated cohort cap",
  CO04: "oversized cohort quota",
  CO05: "premium cohort cycle",
  CO06: "discounted cohort ledger",
  CO07: "limited cohort session",
  CO08: "archived cohort contact",
  CO09: "pending cohort notice",
  CO10: "verified cohort plan",
  CO11: "flagged cohort request",
  CO12: "manual cohort record",
  CO13: "automatic cohort entry",
  CO14: "partial cohort batch",
  CO15: "primary cohort route",
  CO16: "secondary cohort window",
  CO17: "legacy cohort policy",
  CO18: "trial cohort rule",
  CO19: "internal cohort check",
  CO20: "external cohort ticket",
  CO21: "priority cohort queue",
  CO22: "deferred cohort slot",
  CO23: "standard cohort lane",
  CO24: "express cohort tier",
};

/** Description of a cohort code, or "unknown cohort code: <code>". */
export function describeCohort(code: string): string {
  return COHORT_CODES[code] ?? `unknown cohort code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 6, b: 7, c: 8 };

/** Relative weight of a cohort class; unknown classes weigh nothing. */
export function cohortWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCohortWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + cohortWeight(key), 0);
}

/** Scales a cohort amount by the module factor and rounds to a whole number. */
export function cohortScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function cohortShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 cohort" or "3 cohorts". */
export function cohortLabel(count: number): string {
  return count === 1 ? "1 cohort" : `${count} cohorts`;
}

export function cohortSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
