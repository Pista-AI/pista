// orders: exchange helpers.

/** Known exchange codes and what they mean. */
export const EXCHANGE_CODES: Record<string, string> = {
  EX01: "manual exchange notice",
  EX02: "automatic exchange plan",
  EX03: "partial exchange request",
  EX04: "primary exchange record",
  EX05: "secondary exchange entry",
  EX06: "legacy exchange batch",
  EX07: "trial exchange route",
  EX08: "internal exchange window",
  EX09: "external exchange policy",
  EX10: "priority exchange rule",
  EX11: "deferred exchange check",
  EX12: "standard exchange ticket",
  EX13: "express exchange queue",
  EX14: "fragile exchange slot",
  EX15: "bulky exchange lane",
  EX16: "seasonal exchange tier",
  EX17: "returnable exchange group",
  EX18: "perishable exchange profile",
  EX19: "regulated exchange rate",
  EX20: "oversized exchange cap",
  EX21: "premium exchange quota",
  EX22: "discounted exchange cycle",
  EX23: "limited exchange ledger",
  EX24: "archived exchange session",
};

/** Description of a exchange code, or "unknown exchange code: <code>". */
export function describeExchange(code: string): string {
  return EXCHANGE_CODES[code] ?? `unknown exchange code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 17, b: 18, c: 19 };

/** Relative weight of a exchange class; unknown classes weigh nothing. */
export function exchangeWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalExchangeWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + exchangeWeight(key), 0);
}

/** Scales a exchange amount by the module factor and rounds to a whole number. */
export function exchangeScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function exchangeShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 exchange" or "3 exchanges". */
export function exchangeLabel(count: number): string {
  return count === 1 ? "1 exchange" : `${count} exchanges`;
}

export function exchangeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
