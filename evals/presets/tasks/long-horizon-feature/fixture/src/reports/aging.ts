// reports: aging helpers.

/** Known aging codes and what they mean. */
export const AGING_CODES: Record<string, string> = {
  AG01: "express aging ticket",
  AG02: "fragile aging queue",
  AG03: "bulky aging slot",
  AG04: "seasonal aging lane",
  AG05: "returnable aging tier",
  AG06: "perishable aging group",
  AG07: "regulated aging profile",
  AG08: "oversized aging rate",
  AG09: "premium aging cap",
  AG10: "discounted aging quota",
  AG11: "limited aging cycle",
  AG12: "archived aging ledger",
  AG13: "pending aging session",
  AG14: "verified aging contact",
  AG15: "flagged aging notice",
  AG16: "manual aging plan",
  AG17: "automatic aging request",
  AG18: "partial aging record",
  AG19: "primary aging entry",
  AG20: "secondary aging batch",
  AG21: "legacy aging route",
  AG22: "trial aging window",
  AG23: "internal aging policy",
  AG24: "external aging rule",
};

/** Description of a aging code, or "unknown aging code: <code>". */
export function describeAging(code: string): string {
  return AGING_CODES[code] ?? `unknown aging code: ${code}`;
}

/** aging codes are upper-case and prefixed with their kind. */
export function formatAging(value: string): string {
  return "AGI-" + value.trim().toUpperCase();
}

/** Inverse of `formatAging`; undefined when the prefix does not match. */
export function parseAging(code: string): string | undefined {
  const prefix = "AGI-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the aging limits (0 to 128). */
export function isAgingValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 128;
}

export function clampAging(n: number): number {
  return Math.min(128, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 29, b: 30, c: 31 };

/** Relative weight of a aging class; unknown classes weigh nothing. */
export function agingWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalAgingWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + agingWeight(key), 0);
}
