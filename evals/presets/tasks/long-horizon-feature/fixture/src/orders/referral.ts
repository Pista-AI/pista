// orders: referral helpers.

/** Known referral codes and what they mean. */
export const REFERRAL_CODES: Record<string, string> = {
  RE01: "seasonal referral quota",
  RE02: "returnable referral cycle",
  RE03: "perishable referral ledger",
  RE04: "regulated referral session",
  RE05: "oversized referral contact",
  RE06: "premium referral notice",
  RE07: "discounted referral plan",
  RE08: "limited referral request",
  RE09: "archived referral record",
  RE10: "pending referral entry",
  RE11: "verified referral batch",
  RE12: "flagged referral route",
  RE13: "manual referral window",
  RE14: "automatic referral policy",
  RE15: "partial referral rule",
  RE16: "primary referral check",
  RE17: "secondary referral ticket",
  RE18: "legacy referral queue",
  RE19: "trial referral slot",
  RE20: "internal referral lane",
  RE21: "external referral tier",
  RE22: "priority referral group",
  RE23: "deferred referral profile",
  RE24: "standard referral rate",
};

/** Description of a referral code, or "unknown referral code: <code>". */
export function describeReferral(code: string): string {
  return REFERRAL_CODES[code] ?? `unknown referral code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 32, b: 33, c: 34 };

/** Relative weight of a referral class; unknown classes weigh nothing. */
export function referralWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalReferralWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + referralWeight(key), 0);
}

/** Scales a referral amount by the module factor and rounds to a whole number. */
export function referralScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function referralShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 referral" or "3 referrals". */
export function referralLabel(count: number): string {
  return count === 1 ? "1 referral" : `${count} referrals`;
}

export function referralSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
