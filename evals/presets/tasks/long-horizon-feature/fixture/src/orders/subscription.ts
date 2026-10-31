// orders: subscription helpers.

/** Known subscription codes and what they mean. */
export const SUBSCRIPTION_CODES: Record<string, string> = {
  SU01: "secondary subscription queue",
  SU02: "legacy subscription slot",
  SU03: "trial subscription lane",
  SU04: "internal subscription tier",
  SU05: "external subscription group",
  SU06: "priority subscription profile",
  SU07: "deferred subscription rate",
  SU08: "standard subscription cap",
  SU09: "express subscription quota",
  SU10: "fragile subscription cycle",
  SU11: "bulky subscription ledger",
  SU12: "seasonal subscription session",
  SU13: "returnable subscription contact",
  SU14: "perishable subscription notice",
  SU15: "regulated subscription plan",
  SU16: "oversized subscription request",
  SU17: "premium subscription record",
  SU18: "discounted subscription entry",
  SU19: "limited subscription batch",
  SU20: "archived subscription route",
  SU21: "pending subscription window",
  SU22: "verified subscription policy",
  SU23: "flagged subscription rule",
  SU24: "manual subscription check",
};

/** Description of a subscription code, or "unknown subscription code: <code>". */
export function describeSubscription(code: string): string {
  return SUBSCRIPTION_CODES[code] ?? `unknown subscription code: ${code}`;
}

/** Whether `n` is a whole number inside the subscription limits (0 to 120). */
export function isSubscriptionValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 120;
}

export function clampSubscription(n: number): number {
  return Math.min(120, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 21, b: 22, c: 23 };

/** Relative weight of a subscription class; unknown classes weigh nothing. */
export function subscriptionWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSubscriptionWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + subscriptionWeight(key), 0);
}

/** Scales a subscription amount by the module factor and rounds to a whole number. */
export function subscriptionScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function subscriptionShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
