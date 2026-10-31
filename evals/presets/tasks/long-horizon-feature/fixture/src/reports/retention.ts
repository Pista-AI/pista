// reports: retention helpers.

/** Known retention codes and what they mean. */
export const RETENTION_CODES: Record<string, string> = {
  RE01: "oversized retention plan",
  RE02: "premium retention request",
  RE03: "discounted retention record",
  RE04: "limited retention entry",
  RE05: "archived retention batch",
  RE06: "pending retention route",
  RE07: "verified retention window",
  RE08: "flagged retention policy",
  RE09: "manual retention rule",
  RE10: "automatic retention check",
  RE11: "partial retention ticket",
  RE12: "primary retention queue",
  RE13: "secondary retention slot",
  RE14: "legacy retention lane",
  RE15: "trial retention tier",
  RE16: "internal retention group",
  RE17: "external retention profile",
  RE18: "priority retention rate",
  RE19: "deferred retention cap",
  RE20: "standard retention quota",
  RE21: "express retention cycle",
  RE22: "fragile retention ledger",
  RE23: "bulky retention session",
  RE24: "seasonal retention contact",
};

/** Description of a retention code, or "unknown retention code: <code>". */
export function describeRetention(code: string): string {
  return RETENTION_CODES[code] ?? `unknown retention code: ${code}`;
}

/** retention codes are upper-case and prefixed with their kind. */
export function formatRetention(value: string): string {
  return "RET-" + value.trim().toUpperCase();
}

/** Inverse of `formatRetention`; undefined when the prefix does not match. */
export function parseRetention(code: string): string | undefined {
  const prefix = "RET-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the retention limits (0 to 108). */
export function isRetentionValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 108;
}

export function clampRetention(n: number): number {
  return Math.min(108, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 9, b: 10, c: 11 };

/** Relative weight of a retention class; unknown classes weigh nothing. */
export function retentionWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalRetentionWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + retentionWeight(key), 0);
}
