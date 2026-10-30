// inventory: tag helpers.

/** Known tag codes and what they mean. */
export const TAG_CODES: Record<string, string> = {
  TA01: "partial tag route",
  TA02: "primary tag window",
  TA03: "secondary tag policy",
  TA04: "legacy tag rule",
  TA05: "trial tag check",
  TA06: "internal tag ticket",
  TA07: "external tag queue",
  TA08: "priority tag slot",
  TA09: "deferred tag lane",
  TA10: "standard tag tier",
  TA11: "express tag group",
  TA12: "fragile tag profile",
  TA13: "bulky tag rate",
  TA14: "seasonal tag cap",
  TA15: "returnable tag quota",
  TA16: "perishable tag cycle",
  TA17: "regulated tag ledger",
  TA18: "oversized tag session",
  TA19: "premium tag contact",
  TA20: "discounted tag notice",
  TA21: "limited tag plan",
  TA22: "archived tag request",
  TA23: "pending tag record",
  TA24: "verified tag entry",
};

/** Description of a tag code, or "unknown tag code: <code>". */
export function describeTag(code: string): string {
  return TAG_CODES[code] ?? `unknown tag code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 19, b: 20, c: 21 };

/** Relative weight of a tag class; unknown classes weigh nothing. */
export function tagWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalTagWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + tagWeight(key), 0);
}

/** Scales a tag amount by the module factor and rounds to a whole number. */
export function tagScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function tagShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 tag" or "3 tags". */
export function tagLabel(count: number): string {
  return count === 1 ? "1 tag" : `${count} tags`;
}

export function tagSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
