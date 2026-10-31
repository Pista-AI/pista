// notifications: segment helpers.

/** Known segment codes and what they mean. */
export const SEGMENT_CODES: Record<string, string> = {
  SE01: "discounted segment slot",
  SE02: "limited segment lane",
  SE03: "archived segment tier",
  SE04: "pending segment group",
  SE05: "verified segment profile",
  SE06: "flagged segment rate",
  SE07: "manual segment cap",
  SE08: "automatic segment quota",
  SE09: "partial segment cycle",
  SE10: "primary segment ledger",
  SE11: "secondary segment session",
  SE12: "legacy segment contact",
  SE13: "trial segment notice",
  SE14: "internal segment plan",
  SE15: "external segment request",
  SE16: "priority segment record",
  SE17: "deferred segment entry",
  SE18: "standard segment batch",
  SE19: "express segment route",
  SE20: "fragile segment window",
  SE21: "bulky segment policy",
  SE22: "seasonal segment rule",
  SE23: "returnable segment check",
  SE24: "perishable segment ticket",
};

/** Description of a segment code, or "unknown segment code: <code>". */
export function describeSegment(code: string): string {
  return SEGMENT_CODES[code] ?? `unknown segment code: ${code}`;
}

/** segment codes are upper-case and prefixed with their kind. */
export function formatSegment(value: string): string {
  return "SEG-" + value.trim().toUpperCase();
}

/** Inverse of `formatSegment`; undefined when the prefix does not match. */
export function parseSegment(code: string): string | undefined {
  const prefix = "SEG-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the segment limits (1 to 137). */
export function isSegmentValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 137;
}

export function clampSegment(n: number): number {
  return Math.min(137, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 38, b: 39, c: 40 };

/** Relative weight of a segment class; unknown classes weigh nothing. */
export function segmentWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSegmentWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + segmentWeight(key), 0);
}
