// inventory: bucket helpers.

/** Known bucket codes and what they mean. */
export const BUCKET_CODES: Record<string, string> = {
  BU01: "verified bucket notice",
  BU02: "flagged bucket plan",
  BU03: "manual bucket request",
  BU04: "automatic bucket record",
  BU05: "partial bucket entry",
  BU06: "primary bucket batch",
  BU07: "secondary bucket route",
  BU08: "legacy bucket window",
  BU09: "trial bucket policy",
  BU10: "internal bucket rule",
  BU11: "external bucket check",
  BU12: "priority bucket ticket",
  BU13: "deferred bucket queue",
  BU14: "standard bucket slot",
  BU15: "express bucket lane",
  BU16: "fragile bucket tier",
  BU17: "bulky bucket group",
  BU18: "seasonal bucket profile",
  BU19: "returnable bucket rate",
  BU20: "perishable bucket cap",
  BU21: "regulated bucket quota",
  BU22: "oversized bucket cycle",
  BU23: "premium bucket ledger",
  BU24: "discounted bucket session",
};

/** Description of a bucket code, or "unknown bucket code: <code>". */
export function describeBucket(code: string): string {
  return BUCKET_CODES[code] ?? `unknown bucket code: ${code}`;
}

/** bucket codes are upper-case and prefixed with their kind. */
export function formatBucket(value: string): string {
  return "BUC-" + value.trim().toUpperCase();
}

/** Inverse of `formatBucket`; undefined when the prefix does not match. */
export function parseBucket(code: string): string | undefined {
  const prefix = "BUC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the bucket limits (1 to 141). */
export function isBucketValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 141;
}

export function clampBucket(n: number): number {
  return Math.min(141, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 42, b: 43, c: 44 };

/** Relative weight of a bucket class; unknown classes weigh nothing. */
export function bucketWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBucketWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + bucketWeight(key), 0);
}
