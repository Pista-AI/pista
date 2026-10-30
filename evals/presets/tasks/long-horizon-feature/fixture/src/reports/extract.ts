// reports: extract helpers.

/** Known extract codes and what they mean. */
export const EXTRACT_CODES: Record<string, string> = {
  EX01: "bulky extract profile",
  EX02: "seasonal extract rate",
  EX03: "returnable extract cap",
  EX04: "perishable extract quota",
  EX05: "regulated extract cycle",
  EX06: "oversized extract ledger",
  EX07: "premium extract session",
  EX08: "discounted extract contact",
  EX09: "limited extract notice",
  EX10: "archived extract plan",
  EX11: "pending extract request",
  EX12: "verified extract record",
  EX13: "flagged extract entry",
  EX14: "manual extract batch",
  EX15: "automatic extract route",
  EX16: "partial extract window",
  EX17: "primary extract policy",
  EX18: "secondary extract rule",
  EX19: "legacy extract check",
  EX20: "trial extract ticket",
  EX21: "internal extract queue",
  EX22: "external extract slot",
  EX23: "priority extract lane",
  EX24: "deferred extract tier",
};

/** Description of a extract code, or "unknown extract code: <code>". */
export function describeExtract(code: string): string {
  return EXTRACT_CODES[code] ?? `unknown extract code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 31, b: 32, c: 33 };

/** Relative weight of a extract class; unknown classes weigh nothing. */
export function extractWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalExtractWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + extractWeight(key), 0);
}

/** Scales a extract amount by the module factor and rounds to a whole number. */
export function extractScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function extractShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 extract" or "3 extracts". */
export function extractLabel(count: number): string {
  return count === 1 ? "1 extract" : `${count} extracts`;
}

export function extractSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
