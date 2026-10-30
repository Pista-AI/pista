// billing: cancel helpers.

/** Known cancel codes and what they mean. */
export const CANCEL_CODES: Record<string, string> = {
  CA01: "internal cancel cycle",
  CA02: "external cancel ledger",
  CA03: "priority cancel session",
  CA04: "deferred cancel contact",
  CA05: "standard cancel notice",
  CA06: "express cancel plan",
  CA07: "fragile cancel request",
  CA08: "bulky cancel record",
  CA09: "seasonal cancel entry",
  CA10: "returnable cancel batch",
  CA11: "perishable cancel route",
  CA12: "regulated cancel window",
  CA13: "oversized cancel policy",
  CA14: "premium cancel rule",
  CA15: "discounted cancel check",
  CA16: "limited cancel ticket",
  CA17: "archived cancel queue",
  CA18: "pending cancel slot",
  CA19: "verified cancel lane",
  CA20: "flagged cancel tier",
  CA21: "manual cancel group",
  CA22: "automatic cancel profile",
  CA23: "partial cancel rate",
  CA24: "primary cancel cap",
};

/** Description of a cancel code, or "unknown cancel code: <code>". */
export function describeCancel(code: string): string {
  return CANCEL_CODES[code] ?? `unknown cancel code: ${code}`;
}

/** cancel codes are upper-case and prefixed with their kind. */
export function formatCancel(value: string): string {
  return "CAN-" + value.trim().toUpperCase();
}

/** Inverse of `formatCancel`; undefined when the prefix does not match. */
export function parseCancel(code: string): string | undefined {
  const prefix = "CAN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the cancel limits (3 to 123). */
export function isCancelValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 123;
}

export function clampCancel(n: number): number {
  return Math.min(123, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 24, b: 25, c: 26 };

/** Relative weight of a cancel class; unknown classes weigh nothing. */
export function cancelWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCancelWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + cancelWeight(key), 0);
}
