// inventory: scale helpers.

/** Known scale codes and what they mean. */
export const SCALE_CODES: Record<string, string> = {
  SC01: "oversized scale window",
  SC02: "premium scale policy",
  SC03: "discounted scale rule",
  SC04: "limited scale check",
  SC05: "archived scale ticket",
  SC06: "pending scale queue",
  SC07: "verified scale slot",
  SC08: "flagged scale lane",
  SC09: "manual scale tier",
  SC10: "automatic scale group",
  SC11: "partial scale profile",
  SC12: "primary scale rate",
  SC13: "secondary scale cap",
  SC14: "legacy scale quota",
  SC15: "trial scale cycle",
  SC16: "internal scale ledger",
  SC17: "external scale session",
  SC18: "priority scale contact",
  SC19: "deferred scale notice",
  SC20: "standard scale plan",
  SC21: "express scale request",
  SC22: "fragile scale record",
  SC23: "bulky scale entry",
  SC24: "seasonal scale batch",
};

/** Description of a scale code, or "unknown scale code: <code>". */
export function describeScale(code: string): string {
  return SCALE_CODES[code] ?? `unknown scale code: ${code}`;
}

/** "1 scale" or "3 scales". */
export function scaleLabel(count: number): string {
  return count === 1 ? "1 scale" : `${count} scales`;
}

export function scaleSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** scale codes are upper-case and prefixed with their kind. */
export function formatScale(value: string): string {
  return "SCA-" + value.trim().toUpperCase();
}

/** Inverse of `formatScale`; undefined when the prefix does not match. */
export function parseScale(code: string): string | undefined {
  const prefix = "SCA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the scale limits (3 to 135). */
export function isScaleValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 135;
}

export function clampScale(n: number): number {
  return Math.min(135, Math.max(3, Math.trunc(n)));
}
