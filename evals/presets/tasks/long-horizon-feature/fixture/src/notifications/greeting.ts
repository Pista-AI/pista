// notifications: greeting helpers.

/** Known greeting codes and what they mean. */
export const GREETING_CODES: Record<string, string> = {
  GR01: "trial greeting rate",
  GR02: "internal greeting cap",
  GR03: "external greeting quota",
  GR04: "priority greeting cycle",
  GR05: "deferred greeting ledger",
  GR06: "standard greeting session",
  GR07: "express greeting contact",
  GR08: "fragile greeting notice",
  GR09: "bulky greeting plan",
  GR10: "seasonal greeting request",
  GR11: "returnable greeting record",
  GR12: "perishable greeting entry",
  GR13: "regulated greeting batch",
  GR14: "oversized greeting route",
  GR15: "premium greeting window",
  GR16: "discounted greeting policy",
  GR17: "limited greeting rule",
  GR18: "archived greeting check",
  GR19: "pending greeting ticket",
  GR20: "verified greeting queue",
  GR21: "flagged greeting slot",
  GR22: "manual greeting lane",
  GR23: "automatic greeting tier",
  GR24: "partial greeting group",
};

/** Description of a greeting code, or "unknown greeting code: <code>". */
export function describeGreeting(code: string): string {
  return GREETING_CODES[code] ?? `unknown greeting code: ${code}`;
}

/** greeting codes are upper-case and prefixed with their kind. */
export function formatGreeting(value: string): string {
  return "GRE-" + value.trim().toUpperCase();
}

/** Inverse of `formatGreeting`; undefined when the prefix does not match. */
export function parseGreeting(code: string): string | undefined {
  const prefix = "GRE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the greeting limits (2 to 122). */
export function isGreetingValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 122;
}

export function clampGreeting(n: number): number {
  return Math.min(122, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 23, b: 24, c: 25 };

/** Relative weight of a greeting class; unknown classes weigh nothing. */
export function greetingWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalGreetingWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + greetingWeight(key), 0);
}
