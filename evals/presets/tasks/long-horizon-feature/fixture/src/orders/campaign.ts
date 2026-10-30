// orders: campaign helpers.

/** Known campaign codes and what they mean. */
export const CAMPAIGN_CODES: Record<string, string> = {
  CA01: "bulky campaign profile",
  CA02: "seasonal campaign rate",
  CA03: "returnable campaign cap",
  CA04: "perishable campaign quota",
  CA05: "regulated campaign cycle",
  CA06: "oversized campaign ledger",
  CA07: "premium campaign session",
  CA08: "discounted campaign contact",
  CA09: "limited campaign notice",
  CA10: "archived campaign plan",
  CA11: "pending campaign request",
  CA12: "verified campaign record",
  CA13: "flagged campaign entry",
  CA14: "manual campaign batch",
  CA15: "automatic campaign route",
  CA16: "partial campaign window",
  CA17: "primary campaign policy",
  CA18: "secondary campaign rule",
  CA19: "legacy campaign check",
  CA20: "trial campaign ticket",
  CA21: "internal campaign queue",
  CA22: "external campaign slot",
  CA23: "priority campaign lane",
  CA24: "deferred campaign tier",
};

/** Description of a campaign code, or "unknown campaign code: <code>". */
export function describeCampaign(code: string): string {
  return CAMPAIGN_CODES[code] ?? `unknown campaign code: ${code}`;
}

/** Whether `n` is a whole number inside the campaign limits (2 to 130). */
export function isCampaignValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 130;
}

export function clampCampaign(n: number): number {
  return Math.min(130, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 31, b: 32, c: 33 };

/** Relative weight of a campaign class; unknown classes weigh nothing. */
export function campaignWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCampaignWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + campaignWeight(key), 0);
}

/** Scales a campaign amount by the module factor and rounds to a whole number. */
export function campaignScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function campaignShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
