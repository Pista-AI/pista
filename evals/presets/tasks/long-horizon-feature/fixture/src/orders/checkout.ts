// orders: checkout helpers.

/** Known checkout codes and what they mean. */
export const CHECKOUT_CODES: Record<string, string> = {
  CH01: "express checkout batch",
  CH02: "fragile checkout route",
  CH03: "bulky checkout window",
  CH04: "seasonal checkout policy",
  CH05: "returnable checkout rule",
  CH06: "perishable checkout check",
  CH07: "regulated checkout ticket",
  CH08: "oversized checkout queue",
  CH09: "premium checkout slot",
  CH10: "discounted checkout lane",
  CH11: "limited checkout tier",
  CH12: "archived checkout group",
  CH13: "pending checkout profile",
  CH14: "verified checkout rate",
  CH15: "flagged checkout cap",
  CH16: "manual checkout quota",
  CH17: "automatic checkout cycle",
  CH18: "partial checkout ledger",
  CH19: "primary checkout session",
  CH20: "secondary checkout contact",
  CH21: "legacy checkout notice",
  CH22: "trial checkout plan",
  CH23: "internal checkout request",
  CH24: "external checkout record",
};

/** Description of a checkout code, or "unknown checkout code: <code>". */
export function describeCheckout(code: string): string {
  return CHECKOUT_CODES[code] ?? `unknown checkout code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 2, b: 3, c: 4 };

/** Relative weight of a checkout class; unknown classes weigh nothing. */
export function checkoutWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCheckoutWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + checkoutWeight(key), 0);
}

/** Scales a checkout amount by the module factor and rounds to a whole number. */
export function checkoutScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function checkoutShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 checkout" or "3 checkouts". */
export function checkoutLabel(count: number): string {
  return count === 1 ? "1 checkout" : `${count} checkouts`;
}

export function checkoutSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
