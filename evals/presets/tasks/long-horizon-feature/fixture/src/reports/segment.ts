// reports: segment helpers.

/** Known segment codes and what they mean. */
export const SEGMENT_CODES: Record<string, string> = {
  SE01: "primary segment rule",
  SE02: "secondary segment check",
  SE03: "legacy segment ticket",
  SE04: "trial segment queue",
  SE05: "internal segment slot",
  SE06: "external segment lane",
  SE07: "priority segment tier",
  SE08: "deferred segment group",
  SE09: "standard segment profile",
  SE10: "express segment rate",
  SE11: "fragile segment cap",
  SE12: "bulky segment quota",
  SE13: "seasonal segment cycle",
  SE14: "returnable segment ledger",
  SE15: "perishable segment session",
  SE16: "regulated segment contact",
  SE17: "oversized segment notice",
  SE18: "premium segment plan",
  SE19: "discounted segment request",
  SE20: "limited segment record",
  SE21: "archived segment entry",
  SE22: "pending segment batch",
  SE23: "verified segment route",
  SE24: "flagged segment window",
};

/** Description of a segment code, or "unknown segment code: <code>". */
export function describeSegment(code: string): string {
  return SEGMENT_CODES[code] ?? `unknown segment code: ${code}`;
}

/** Whether `n` is a whole number inside the segment limits (3 to 119). */
export function isSegmentValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 119;
}

export function clampSegment(n: number): number {
  return Math.min(119, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 20, b: 21, c: 22 };

/** Relative weight of a segment class; unknown classes weigh nothing. */
export function segmentWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSegmentWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + segmentWeight(key), 0);
}

/** Scales a segment amount by the module factor and rounds to a whole number. */
export function segmentScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function segmentShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
