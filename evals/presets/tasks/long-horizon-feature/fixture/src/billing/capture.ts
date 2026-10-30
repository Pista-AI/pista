// billing: capture helpers.

/** Known capture codes and what they mean. */
export const CAPTURE_CODES: Record<string, string> = {
  CA01: "returnable capture profile",
  CA02: "perishable capture rate",
  CA03: "regulated capture cap",
  CA04: "oversized capture quota",
  CA05: "premium capture cycle",
  CA06: "discounted capture ledger",
  CA07: "limited capture session",
  CA08: "archived capture contact",
  CA09: "pending capture notice",
  CA10: "verified capture plan",
  CA11: "flagged capture request",
  CA12: "manual capture record",
  CA13: "automatic capture entry",
  CA14: "partial capture batch",
  CA15: "primary capture route",
  CA16: "secondary capture window",
  CA17: "legacy capture policy",
  CA18: "trial capture rule",
  CA19: "internal capture check",
  CA20: "external capture ticket",
  CA21: "priority capture queue",
  CA22: "deferred capture slot",
  CA23: "standard capture lane",
  CA24: "express capture tier",
};

/** Description of a capture code, or "unknown capture code: <code>". */
export function describeCapture(code: string): string {
  return CAPTURE_CODES[code] ?? `unknown capture code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 6, b: 7, c: 8 };

/** Relative weight of a capture class; unknown classes weigh nothing. */
export function captureWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCaptureWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + captureWeight(key), 0);
}

/** Scales a capture amount by the module factor and rounds to a whole number. */
export function captureScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function captureShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 capture" or "3 captures". */
export function captureLabel(count: number): string {
  return count === 1 ? "1 capture" : `${count} captures`;
}

export function captureSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
