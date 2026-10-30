// billing: statement helpers.

/** Known statement codes and what they mean. */
export const STATEMENT_CODES: Record<string, string> = {
  ST01: "verified statement cap",
  ST02: "flagged statement quota",
  ST03: "manual statement cycle",
  ST04: "automatic statement ledger",
  ST05: "partial statement session",
  ST06: "primary statement contact",
  ST07: "secondary statement notice",
  ST08: "legacy statement plan",
  ST09: "trial statement request",
  ST10: "internal statement record",
  ST11: "external statement entry",
  ST12: "priority statement batch",
  ST13: "deferred statement route",
  ST14: "standard statement window",
  ST15: "express statement policy",
  ST16: "fragile statement rule",
  ST17: "bulky statement check",
  ST18: "seasonal statement ticket",
  ST19: "returnable statement queue",
  ST20: "perishable statement slot",
  ST21: "regulated statement lane",
  ST22: "oversized statement tier",
  ST23: "premium statement group",
  ST24: "discounted statement profile",
};

/** Description of a statement code, or "unknown statement code: <code>". */
export function describeStatement(code: string): string {
  return STATEMENT_CODES[code] ?? `unknown statement code: ${code}`;
}

/** Whether `n` is a whole number inside the statement limits (2 to 114). */
export function isStatementValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 114;
}

export function clampStatement(n: number): number {
  return Math.min(114, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 15, b: 16, c: 17 };

/** Relative weight of a statement class; unknown classes weigh nothing. */
export function statementWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalStatementWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + statementWeight(key), 0);
}

/** Scales a statement amount by the module factor and rounds to a whole number. */
export function statementScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function statementShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
