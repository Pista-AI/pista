// orders: handling helpers.

/** Known handling codes and what they mean. */
export const HANDLING_CODES: Record<string, string> = {
  HA01: "premium handling check",
  HA02: "discounted handling ticket",
  HA03: "limited handling queue",
  HA04: "archived handling slot",
  HA05: "pending handling lane",
  HA06: "verified handling tier",
  HA07: "flagged handling group",
  HA08: "manual handling profile",
  HA09: "automatic handling rate",
  HA10: "partial handling cap",
  HA11: "primary handling quota",
  HA12: "secondary handling cycle",
  HA13: "legacy handling ledger",
  HA14: "trial handling session",
  HA15: "internal handling contact",
  HA16: "external handling notice",
  HA17: "priority handling plan",
  HA18: "deferred handling request",
  HA19: "standard handling record",
  HA20: "express handling entry",
  HA21: "fragile handling batch",
  HA22: "bulky handling route",
  HA23: "seasonal handling window",
  HA24: "returnable handling policy",
};

/** Description of a handling code, or "unknown handling code: <code>". */
export function describeHandling(code: string): string {
  return HANDLING_CODES[code] ?? `unknown handling code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 37, b: 38, c: 39 };

/** Relative weight of a handling class; unknown classes weigh nothing. */
export function handlingWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalHandlingWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + handlingWeight(key), 0);
}

/** Scales a handling amount by the module factor and rounds to a whole number. */
export function handlingScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function handlingShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 handling" or "3 handlings". */
export function handlingLabel(count: number): string {
  return count === 1 ? "1 handling" : `${count} handlings`;
}

export function handlingSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
