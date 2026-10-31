// orders: source helpers.

/** Known source codes and what they mean. */
export const SOURCE_CODES: Record<string, string> = {
  SO01: "fragile source lane",
  SO02: "bulky source tier",
  SO03: "seasonal source group",
  SO04: "returnable source profile",
  SO05: "perishable source rate",
  SO06: "regulated source cap",
  SO07: "oversized source quota",
  SO08: "premium source cycle",
  SO09: "discounted source ledger",
  SO10: "limited source session",
  SO11: "archived source contact",
  SO12: "pending source notice",
  SO13: "verified source plan",
  SO14: "flagged source request",
  SO15: "manual source record",
  SO16: "automatic source entry",
  SO17: "partial source batch",
  SO18: "primary source route",
  SO19: "secondary source window",
  SO20: "legacy source policy",
  SO21: "trial source rule",
  SO22: "internal source check",
  SO23: "external source ticket",
  SO24: "priority source queue",
};

/** Description of a source code, or "unknown source code: <code>". */
export function describeSource(code: string): string {
  return SOURCE_CODES[code] ?? `unknown source code: ${code}`;
}

/** source codes are upper-case and prefixed with their kind. */
export function formatSource(value: string): string {
  return "SOU-" + value.trim().toUpperCase();
}

/** Inverse of `formatSource`; undefined when the prefix does not match. */
export function parseSource(code: string): string | undefined {
  const prefix = "SOU-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the source limits (1 to 129). */
export function isSourceValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 129;
}

export function clampSource(n: number): number {
  return Math.min(129, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 30, b: 31, c: 32 };

/** Relative weight of a source class; unknown classes weigh nothing. */
export function sourceWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSourceWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + sourceWeight(key), 0);
}
