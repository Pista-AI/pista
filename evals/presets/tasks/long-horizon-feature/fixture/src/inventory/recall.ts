// inventory: recall helpers.

/** Known recall codes and what they mean. */
export const RECALL_CODES: Record<string, string> = {
  RE01: "bulky recall profile",
  RE02: "seasonal recall rate",
  RE03: "returnable recall cap",
  RE04: "perishable recall quota",
  RE05: "regulated recall cycle",
  RE06: "oversized recall ledger",
  RE07: "premium recall session",
  RE08: "discounted recall contact",
  RE09: "limited recall notice",
  RE10: "archived recall plan",
  RE11: "pending recall request",
  RE12: "verified recall record",
  RE13: "flagged recall entry",
  RE14: "manual recall batch",
  RE15: "automatic recall route",
  RE16: "partial recall window",
  RE17: "primary recall policy",
  RE18: "secondary recall rule",
  RE19: "legacy recall check",
  RE20: "trial recall ticket",
  RE21: "internal recall queue",
  RE22: "external recall slot",
  RE23: "priority recall lane",
  RE24: "deferred recall tier",
};

/** Description of a recall code, or "unknown recall code: <code>". */
export function describeRecall(code: string): string {
  return RECALL_CODES[code] ?? `unknown recall code: ${code}`;
}

/** "1 recall" or "3 recalls". */
export function recallLabel(count: number): string {
  return count === 1 ? "1 recall" : `${count} recalls`;
}

export function recallSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** recall codes are upper-case and prefixed with their kind. */
export function formatRecall(value: string): string {
  return "REC-" + value.trim().toUpperCase();
}

/** Inverse of `formatRecall`; undefined when the prefix does not match. */
export function parseRecall(code: string): string | undefined {
  const prefix = "REC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the recall limits (2 to 130). */
export function isRecallValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 130;
}

export function clampRecall(n: number): number {
  return Math.min(130, Math.max(2, Math.trunc(n)));
}
