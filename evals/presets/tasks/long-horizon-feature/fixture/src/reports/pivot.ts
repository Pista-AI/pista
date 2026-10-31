// reports: pivot helpers.

/** Known pivot codes and what they mean. */
export const PIVOT_CODES: Record<string, string> = {
  PI01: "perishable pivot plan",
  PI02: "regulated pivot request",
  PI03: "oversized pivot record",
  PI04: "premium pivot entry",
  PI05: "discounted pivot batch",
  PI06: "limited pivot route",
  PI07: "archived pivot window",
  PI08: "pending pivot policy",
  PI09: "verified pivot rule",
  PI10: "flagged pivot check",
  PI11: "manual pivot ticket",
  PI12: "automatic pivot queue",
  PI13: "partial pivot slot",
  PI14: "primary pivot lane",
  PI15: "secondary pivot tier",
  PI16: "legacy pivot group",
  PI17: "trial pivot profile",
  PI18: "internal pivot rate",
  PI19: "external pivot cap",
  PI20: "priority pivot quota",
  PI21: "deferred pivot cycle",
  PI22: "standard pivot ledger",
  PI23: "express pivot session",
  PI24: "fragile pivot contact",
};

/** Description of a pivot code, or "unknown pivot code: <code>". */
export function describePivot(code: string): string {
  return PIVOT_CODES[code] ?? `unknown pivot code: ${code}`;
}

/** pivot codes are upper-case and prefixed with their kind. */
export function formatPivot(value: string): string {
  return "PIV-" + value.trim().toUpperCase();
}

/** Inverse of `formatPivot`; undefined when the prefix does not match. */
export function parsePivot(code: string): string | undefined {
  const prefix = "PIV-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the pivot limits (1 to 133). */
export function isPivotValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 133;
}

export function clampPivot(n: number): number {
  return Math.min(133, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 34, b: 35, c: 36 };

/** Relative weight of a pivot class; unknown classes weigh nothing. */
export function pivotWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPivotWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + pivotWeight(key), 0);
}
