// reports: supplier helpers.

/** Known supplier codes and what they mean. */
export const SUPPLIER_CODES: Record<string, string> = {
  SU01: "internal supplier cycle",
  SU02: "external supplier ledger",
  SU03: "priority supplier session",
  SU04: "deferred supplier contact",
  SU05: "standard supplier notice",
  SU06: "express supplier plan",
  SU07: "fragile supplier request",
  SU08: "bulky supplier record",
  SU09: "seasonal supplier entry",
  SU10: "returnable supplier batch",
  SU11: "perishable supplier route",
  SU12: "regulated supplier window",
  SU13: "oversized supplier policy",
  SU14: "premium supplier rule",
  SU15: "discounted supplier check",
  SU16: "limited supplier ticket",
  SU17: "archived supplier queue",
  SU18: "pending supplier slot",
  SU19: "verified supplier lane",
  SU20: "flagged supplier tier",
  SU21: "manual supplier group",
  SU22: "automatic supplier profile",
  SU23: "partial supplier rate",
  SU24: "primary supplier cap",
};

/** Description of a supplier code, or "unknown supplier code: <code>". */
export function describeSupplier(code: string): string {
  return SUPPLIER_CODES[code] ?? `unknown supplier code: ${code}`;
}

/** supplier codes are upper-case and prefixed with their kind. */
export function formatSupplier(value: string): string {
  return "SUP-" + value.trim().toUpperCase();
}

/** Inverse of `formatSupplier`; undefined when the prefix does not match. */
export function parseSupplier(code: string): string | undefined {
  const prefix = "SUP-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the supplier limits (3 to 123). */
export function isSupplierValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 123;
}

export function clampSupplier(n: number): number {
  return Math.min(123, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 24, b: 25, c: 26 };

/** Relative weight of a supplier class; unknown classes weigh nothing. */
export function supplierWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSupplierWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + supplierWeight(key), 0);
}
