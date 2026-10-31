// notifications: push helpers.

/** Known push codes and what they mean. */
export const PUSH_CODES: Record<string, string> = {
  PU01: "fragile push policy",
  PU02: "bulky push rule",
  PU03: "seasonal push check",
  PU04: "returnable push ticket",
  PU05: "perishable push queue",
  PU06: "regulated push slot",
  PU07: "oversized push lane",
  PU08: "premium push tier",
  PU09: "discounted push group",
  PU10: "limited push profile",
  PU11: "archived push rate",
  PU12: "pending push cap",
  PU13: "verified push quota",
  PU14: "flagged push cycle",
  PU15: "manual push ledger",
  PU16: "automatic push session",
  PU17: "partial push contact",
  PU18: "primary push notice",
  PU19: "secondary push plan",
  PU20: "legacy push request",
  PU21: "trial push record",
  PU22: "internal push entry",
  PU23: "external push batch",
  PU24: "priority push route",
};

/** Description of a push code, or "unknown push code: <code>". */
export function describePush(code: string): string {
  return PUSH_CODES[code] ?? `unknown push code: ${code}`;
}

/** push codes are upper-case and prefixed with their kind. */
export function formatPush(value: string): string {
  return "PUS-" + value.trim().toUpperCase();
}

/** Inverse of `formatPush`; undefined when the prefix does not match. */
export function parsePush(code: string): string | undefined {
  const prefix = "PUS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the push limits (2 to 102). */
export function isPushValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 102;
}

export function clampPush(n: number): number {
  return Math.min(102, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 3, b: 4, c: 5 };

/** Relative weight of a push class; unknown classes weigh nothing. */
export function pushWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPushWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + pushWeight(key), 0);
}
