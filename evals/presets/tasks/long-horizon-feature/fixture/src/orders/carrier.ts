// orders: carrier helpers.

/** Known carrier codes and what they mean. */
export const CARRIER_CODES: Record<string, string> = {
  CA01: "regulated carrier session",
  CA02: "oversized carrier contact",
  CA03: "premium carrier notice",
  CA04: "discounted carrier plan",
  CA05: "limited carrier request",
  CA06: "archived carrier record",
  CA07: "pending carrier entry",
  CA08: "verified carrier batch",
  CA09: "flagged carrier route",
  CA10: "manual carrier window",
  CA11: "automatic carrier policy",
  CA12: "partial carrier rule",
  CA13: "primary carrier check",
  CA14: "secondary carrier ticket",
  CA15: "legacy carrier queue",
  CA16: "trial carrier slot",
  CA17: "internal carrier lane",
  CA18: "external carrier tier",
  CA19: "priority carrier group",
  CA20: "deferred carrier profile",
  CA21: "standard carrier rate",
  CA22: "express carrier cap",
  CA23: "fragile carrier quota",
  CA24: "bulky carrier cycle",
};

/** Description of a carrier code, or "unknown carrier code: <code>". */
export function describeCarrier(code: string): string {
  return CARRIER_CODES[code] ?? `unknown carrier code: ${code}`;
}

/** Scales a carrier amount by the module factor and rounds to a whole number. */
export function carrierScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function carrierShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 carrier" or "3 carriers". */
export function carrierLabel(count: number): string {
  return count === 1 ? "1 carrier" : `${count} carriers`;
}

export function carrierSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** carrier codes are upper-case and prefixed with their kind. */
export function formatCarrier(value: string): string {
  return "CAR-" + value.trim().toUpperCase();
}

/** Inverse of `formatCarrier`; undefined when the prefix does not match. */
export function parseCarrier(code: string): string | undefined {
  const prefix = "CAR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
