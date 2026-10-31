// billing: adjust helpers.

/** Known adjust codes and what they mean. */
export const ADJUST_CODES: Record<string, string> = {
  AD01: "limited adjust group",
  AD02: "archived adjust profile",
  AD03: "pending adjust rate",
  AD04: "verified adjust cap",
  AD05: "flagged adjust quota",
  AD06: "manual adjust cycle",
  AD07: "automatic adjust ledger",
  AD08: "partial adjust session",
  AD09: "primary adjust contact",
  AD10: "secondary adjust notice",
  AD11: "legacy adjust plan",
  AD12: "trial adjust request",
  AD13: "internal adjust record",
  AD14: "external adjust entry",
  AD15: "priority adjust batch",
  AD16: "deferred adjust route",
  AD17: "standard adjust window",
  AD18: "express adjust policy",
  AD19: "fragile adjust rule",
  AD20: "bulky adjust check",
  AD21: "seasonal adjust ticket",
  AD22: "returnable adjust queue",
  AD23: "perishable adjust slot",
  AD24: "regulated adjust lane",
};

/** Description of a adjust code, or "unknown adjust code: <code>". */
export function describeAdjust(code: string): string {
  return ADJUST_CODES[code] ?? `unknown adjust code: ${code}`;
}

/** adjust codes are upper-case and prefixed with their kind. */
export function formatAdjust(value: string): string {
  return "ADJ-" + value.trim().toUpperCase();
}

/** Inverse of `formatAdjust`; undefined when the prefix does not match. */
export function parseAdjust(code: string): string | undefined {
  const prefix = "ADJ-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the adjust limits (2 to 138). */
export function isAdjustValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 138;
}

export function clampAdjust(n: number): number {
  return Math.min(138, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 39, b: 40, c: 41 };

/** Relative weight of a adjust class; unknown classes weigh nothing. */
export function adjustWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalAdjustWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + adjustWeight(key), 0);
}
