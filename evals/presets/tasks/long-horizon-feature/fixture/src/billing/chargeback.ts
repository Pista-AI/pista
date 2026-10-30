// billing: chargeback helpers.

/** Known chargeback codes and what they mean. */
export const CHARGEBACK_CODES: Record<string, string> = {
  CH01: "oversized chargeback plan",
  CH02: "premium chargeback request",
  CH03: "discounted chargeback record",
  CH04: "limited chargeback entry",
  CH05: "archived chargeback batch",
  CH06: "pending chargeback route",
  CH07: "verified chargeback window",
  CH08: "flagged chargeback policy",
  CH09: "manual chargeback rule",
  CH10: "automatic chargeback check",
  CH11: "partial chargeback ticket",
  CH12: "primary chargeback queue",
  CH13: "secondary chargeback slot",
  CH14: "legacy chargeback lane",
  CH15: "trial chargeback tier",
  CH16: "internal chargeback group",
  CH17: "external chargeback profile",
  CH18: "priority chargeback rate",
  CH19: "deferred chargeback cap",
  CH20: "standard chargeback quota",
  CH21: "express chargeback cycle",
  CH22: "fragile chargeback ledger",
  CH23: "bulky chargeback session",
  CH24: "seasonal chargeback contact",
};

/** Description of a chargeback code, or "unknown chargeback code: <code>". */
export function describeChargeback(code: string): string {
  return CHARGEBACK_CODES[code] ?? `unknown chargeback code: ${code}`;
}

/** chargeback codes are upper-case and prefixed with their kind. */
export function formatChargeback(value: string): string {
  return "CHA-" + value.trim().toUpperCase();
}

/** Inverse of `formatChargeback`; undefined when the prefix does not match. */
export function parseChargeback(code: string): string | undefined {
  const prefix = "CHA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the chargeback limits (0 to 108). */
export function isChargebackValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 108;
}

export function clampChargeback(n: number): number {
  return Math.min(108, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 9, b: 10, c: 11 };

/** Relative weight of a chargeback class; unknown classes weigh nothing. */
export function chargebackWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalChargebackWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + chargebackWeight(key), 0);
}
