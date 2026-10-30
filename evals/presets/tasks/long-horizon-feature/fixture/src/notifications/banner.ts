// notifications: banner helpers.

/** Known banner codes and what they mean. */
export const BANNER_CODES: Record<string, string> = {
  BA01: "seasonal banner lane",
  BA02: "returnable banner tier",
  BA03: "perishable banner group",
  BA04: "regulated banner profile",
  BA05: "oversized banner rate",
  BA06: "premium banner cap",
  BA07: "discounted banner quota",
  BA08: "limited banner cycle",
  BA09: "archived banner ledger",
  BA10: "pending banner session",
  BA11: "verified banner contact",
  BA12: "flagged banner notice",
  BA13: "manual banner plan",
  BA14: "automatic banner request",
  BA15: "partial banner record",
  BA16: "primary banner entry",
  BA17: "secondary banner batch",
  BA18: "legacy banner route",
  BA19: "trial banner window",
  BA20: "internal banner policy",
  BA21: "external banner rule",
  BA22: "priority banner check",
  BA23: "deferred banner ticket",
  BA24: "standard banner queue",
};

/** Description of a banner code, or "unknown banner code: <code>". */
export function describeBanner(code: string): string {
  return BANNER_CODES[code] ?? `unknown banner code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 5, b: 6, c: 7 };

/** Relative weight of a banner class; unknown classes weigh nothing. */
export function bannerWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBannerWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + bannerWeight(key), 0);
}

/** Scales a banner amount by the module factor and rounds to a whole number. */
export function bannerScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function bannerShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 banner" or "3 banners". */
export function bannerLabel(count: number): string {
  return count === 1 ? "1 banner" : `${count} banners`;
}

export function bannerSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
