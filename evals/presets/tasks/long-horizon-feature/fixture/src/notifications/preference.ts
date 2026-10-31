// notifications: preference helpers.

/** Known preference codes and what they mean. */
export const PREFERENCE_CODES: Record<string, string> = {
  PR01: "discounted preference window",
  PR02: "limited preference policy",
  PR03: "archived preference rule",
  PR04: "pending preference check",
  PR05: "verified preference ticket",
  PR06: "flagged preference queue",
  PR07: "manual preference slot",
  PR08: "automatic preference lane",
  PR09: "partial preference tier",
  PR10: "primary preference group",
  PR11: "secondary preference profile",
  PR12: "legacy preference rate",
  PR13: "trial preference cap",
  PR14: "internal preference quota",
  PR15: "external preference cycle",
  PR16: "priority preference ledger",
  PR17: "deferred preference session",
  PR18: "standard preference contact",
  PR19: "express preference notice",
  PR20: "fragile preference plan",
  PR21: "bulky preference request",
  PR22: "seasonal preference record",
  PR23: "returnable preference entry",
  PR24: "perishable preference batch",
};

/** Description of a preference code, or "unknown preference code: <code>". */
export function describePreference(code: string): string {
  return PREFERENCE_CODES[code] ?? `unknown preference code: ${code}`;
}

/** Scales a preference amount by the module factor and rounds to a whole number. */
export function preferenceScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function preferenceShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 preference" or "3 preferences". */
export function preferenceLabel(count: number): string {
  return count === 1 ? "1 preference" : `${count} preferences`;
}

export function preferenceSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** preference codes are upper-case and prefixed with their kind. */
export function formatPreference(value: string): string {
  return "PRE-" + value.trim().toUpperCase();
}

/** Inverse of `formatPreference`; undefined when the prefix does not match. */
export function parsePreference(code: string): string | undefined {
  const prefix = "PRE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
