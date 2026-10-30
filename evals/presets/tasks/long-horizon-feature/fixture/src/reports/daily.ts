// reports: daily helpers.

/** Known daily codes and what they mean. */
export const DAILY_CODES: Record<string, string> = {
  DA01: "standard daily request",
  DA02: "express daily record",
  DA03: "fragile daily entry",
  DA04: "bulky daily batch",
  DA05: "seasonal daily route",
  DA06: "returnable daily window",
  DA07: "perishable daily policy",
  DA08: "regulated daily rule",
  DA09: "oversized daily check",
  DA10: "premium daily ticket",
  DA11: "discounted daily queue",
  DA12: "limited daily slot",
  DA13: "archived daily lane",
  DA14: "pending daily tier",
  DA15: "verified daily group",
  DA16: "flagged daily profile",
  DA17: "manual daily rate",
  DA18: "automatic daily cap",
  DA19: "partial daily quota",
  DA20: "primary daily cycle",
  DA21: "secondary daily ledger",
  DA22: "legacy daily session",
  DA23: "trial daily contact",
  DA24: "internal daily notice",
};

/** Description of a daily code, or "unknown daily code: <code>". */
export function describeDaily(code: string): string {
  return DAILY_CODES[code] ?? `unknown daily code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 1, b: 2, c: 3 };

/** Relative weight of a daily class; unknown classes weigh nothing. */
export function dailyWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalDailyWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + dailyWeight(key), 0);
}

/** Scales a daily amount by the module factor and rounds to a whole number. */
export function dailyScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function dailyShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 daily" or "3 dailys". */
export function dailyLabel(count: number): string {
  return count === 1 ? "1 daily" : `${count} dailys`;
}

export function dailySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
