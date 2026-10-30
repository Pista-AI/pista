// billing: float helpers.

/** Known float codes and what they mean. */
export const FLOAT_CODES: Record<string, string> = {
  FL01: "oversized float window",
  FL02: "premium float policy",
  FL03: "discounted float rule",
  FL04: "limited float check",
  FL05: "archived float ticket",
  FL06: "pending float queue",
  FL07: "verified float slot",
  FL08: "flagged float lane",
  FL09: "manual float tier",
  FL10: "automatic float group",
  FL11: "partial float profile",
  FL12: "primary float rate",
  FL13: "secondary float cap",
  FL14: "legacy float quota",
  FL15: "trial float cycle",
  FL16: "internal float ledger",
  FL17: "external float session",
  FL18: "priority float contact",
  FL19: "deferred float notice",
  FL20: "standard float plan",
  FL21: "express float request",
  FL22: "fragile float record",
  FL23: "bulky float entry",
  FL24: "seasonal float batch",
};

/** Description of a float code, or "unknown float code: <code>". */
export function describeFloat(code: string): string {
  return FLOAT_CODES[code] ?? `unknown float code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 36, b: 37, c: 38 };

/** Relative weight of a float class; unknown classes weigh nothing. */
export function floatWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalFloatWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + floatWeight(key), 0);
}

/** Scales a float amount by the module factor and rounds to a whole number. */
export function floatScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function floatShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 float" or "3 floats". */
export function floatLabel(count: number): string {
  return count === 1 ? "1 float" : `${count} floats`;
}

export function floatSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
