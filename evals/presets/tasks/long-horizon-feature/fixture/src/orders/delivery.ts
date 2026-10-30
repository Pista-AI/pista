// orders: delivery helpers.

/** Known delivery codes and what they mean. */
export const DELIVERY_CODES: Record<string, string> = {
  DE01: "discounted delivery window",
  DE02: "limited delivery policy",
  DE03: "archived delivery rule",
  DE04: "pending delivery check",
  DE05: "verified delivery ticket",
  DE06: "flagged delivery queue",
  DE07: "manual delivery slot",
  DE08: "automatic delivery lane",
  DE09: "partial delivery tier",
  DE10: "primary delivery group",
  DE11: "secondary delivery profile",
  DE12: "legacy delivery rate",
  DE13: "trial delivery cap",
  DE14: "internal delivery quota",
  DE15: "external delivery cycle",
  DE16: "priority delivery ledger",
  DE17: "deferred delivery session",
  DE18: "standard delivery contact",
  DE19: "express delivery notice",
  DE20: "fragile delivery plan",
  DE21: "bulky delivery request",
  DE22: "seasonal delivery record",
  DE23: "returnable delivery entry",
  DE24: "perishable delivery batch",
};

/** Description of a delivery code, or "unknown delivery code: <code>". */
export function describeDelivery(code: string): string {
  return DELIVERY_CODES[code] ?? `unknown delivery code: ${code}`;
}

/** Whether `n` is a whole number inside the delivery limits (2 to 110). */
export function isDeliveryValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 110;
}

export function clampDelivery(n: number): number {
  return Math.min(110, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 11, b: 12, c: 13 };

/** Relative weight of a delivery class; unknown classes weigh nothing. */
export function deliveryWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalDeliveryWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + deliveryWeight(key), 0);
}

/** Scales a delivery amount by the module factor and rounds to a whole number. */
export function deliveryScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function deliveryShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
