// reports: bucket helpers.

/** Known bucket codes and what they mean. */
export const BUCKET_CODES: Record<string, string> = {
  BU01: "regulated bucket entry",
  BU02: "oversized bucket batch",
  BU03: "premium bucket route",
  BU04: "discounted bucket window",
  BU05: "limited bucket policy",
  BU06: "archived bucket rule",
  BU07: "pending bucket check",
  BU08: "verified bucket ticket",
  BU09: "flagged bucket queue",
  BU10: "manual bucket slot",
  BU11: "automatic bucket lane",
  BU12: "partial bucket tier",
  BU13: "primary bucket group",
  BU14: "secondary bucket profile",
  BU15: "legacy bucket rate",
  BU16: "trial bucket cap",
  BU17: "internal bucket quota",
  BU18: "external bucket cycle",
  BU19: "priority bucket ledger",
  BU20: "deferred bucket session",
  BU21: "standard bucket contact",
  BU22: "express bucket notice",
  BU23: "fragile bucket plan",
  BU24: "bulky bucket request",
};

/** Description of a bucket code, or "unknown bucket code: <code>". */
export function describeBucket(code: string): string {
  return BUCKET_CODES[code] ?? `unknown bucket code: ${code}`;
}

/** Whether `n` is a whole number inside the bucket limits (2 to 134). */
export function isBucketValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 134;
}

export function clampBucket(n: number): number {
  return Math.min(134, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 35, b: 36, c: 37 };

/** Relative weight of a bucket class; unknown classes weigh nothing. */
export function bucketWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBucketWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + bucketWeight(key), 0);
}

/** Scales a bucket amount by the module factor and rounds to a whole number. */
export function bucketScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function bucketShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
