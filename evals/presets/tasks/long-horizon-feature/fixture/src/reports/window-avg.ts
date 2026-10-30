// reports: window-avg helpers.

/** Known window-avg codes and what they mean. */
export const WINDOW_AVG_CODES: Record<string, string> = {
  WI01: "oversized window-avg window",
  WI02: "premium window-avg policy",
  WI03: "discounted window-avg rule",
  WI04: "limited window-avg check",
  WI05: "archived window-avg ticket",
  WI06: "pending window-avg queue",
  WI07: "verified window-avg slot",
  WI08: "flagged window-avg lane",
  WI09: "manual window-avg tier",
  WI10: "automatic window-avg group",
  WI11: "partial window-avg profile",
  WI12: "primary window-avg rate",
  WI13: "secondary window-avg cap",
  WI14: "legacy window-avg quota",
  WI15: "trial window-avg cycle",
  WI16: "internal window-avg ledger",
  WI17: "external window-avg session",
  WI18: "priority window-avg contact",
  WI19: "deferred window-avg notice",
  WI20: "standard window-avg plan",
  WI21: "express window-avg request",
  WI22: "fragile window-avg record",
  WI23: "bulky window-avg entry",
  WI24: "seasonal window-avg batch",
};

/** Description of a window-avg code, or "unknown window-avg code: <code>". */
export function describeWindowAvg(code: string): string {
  return WINDOW_AVG_CODES[code] ?? `unknown window-avg code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 36, b: 37, c: 38 };

/** Relative weight of a window-avg class; unknown classes weigh nothing. */
export function windowAvgWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalWindowAvgWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + windowAvgWeight(key), 0);
}

/** Scales a window-avg amount by the module factor and rounds to a whole number. */
export function windowAvgScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function windowAvgShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 window-avg" or "3 window-avgs". */
export function windowAvgLabel(count: number): string {
  return count === 1 ? "1 window-avg" : `${count} window-avgs`;
}

export function windowAvgSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
