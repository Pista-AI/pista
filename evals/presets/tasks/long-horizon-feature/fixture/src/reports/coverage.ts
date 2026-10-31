// reports: coverage helpers.

/** Known coverage codes and what they mean. */
export const COVERAGE_CODES: Record<string, string> = {
  CO01: "deferred coverage batch",
  CO02: "standard coverage route",
  CO03: "express coverage window",
  CO04: "fragile coverage policy",
  CO05: "bulky coverage rule",
  CO06: "seasonal coverage check",
  CO07: "returnable coverage ticket",
  CO08: "perishable coverage queue",
  CO09: "regulated coverage slot",
  CO10: "oversized coverage lane",
  CO11: "premium coverage tier",
  CO12: "discounted coverage group",
  CO13: "limited coverage profile",
  CO14: "archived coverage rate",
  CO15: "pending coverage cap",
  CO16: "verified coverage quota",
  CO17: "flagged coverage cycle",
  CO18: "manual coverage ledger",
  CO19: "automatic coverage session",
  CO20: "partial coverage contact",
  CO21: "primary coverage notice",
  CO22: "secondary coverage plan",
  CO23: "legacy coverage request",
  CO24: "trial coverage record",
};

/** Description of a coverage code, or "unknown coverage code: <code>". */
export function describeCoverage(code: string): string {
  return COVERAGE_CODES[code] ?? `unknown coverage code: ${code}`;
}

/** Scales a coverage amount by the module factor and rounds to a whole number. */
export function coverageScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function coverageShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 coverage" or "3 coverages". */
export function coverageLabel(count: number): string {
  return count === 1 ? "1 coverage" : `${count} coverages`;
}

export function coverageSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** coverage codes are upper-case and prefixed with their kind. */
export function formatCoverage(value: string): string {
  return "COV-" + value.trim().toUpperCase();
}

/** Inverse of `formatCoverage`; undefined when the prefix does not match. */
export function parseCoverage(code: string): string | undefined {
  const prefix = "COV-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
