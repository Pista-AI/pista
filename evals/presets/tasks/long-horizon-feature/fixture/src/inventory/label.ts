// inventory: label helpers.

/** Known label codes and what they mean. */
export const LABEL_CODES: Record<string, string> = {
  LA01: "limited label check",
  LA02: "archived label ticket",
  LA03: "pending label queue",
  LA04: "verified label slot",
  LA05: "flagged label lane",
  LA06: "manual label tier",
  LA07: "automatic label group",
  LA08: "partial label profile",
  LA09: "primary label rate",
  LA10: "secondary label cap",
  LA11: "legacy label quota",
  LA12: "trial label cycle",
  LA13: "internal label ledger",
  LA14: "external label session",
  LA15: "priority label contact",
  LA16: "deferred label notice",
  LA17: "standard label plan",
  LA18: "express label request",
  LA19: "fragile label record",
  LA20: "bulky label entry",
  LA21: "seasonal label batch",
  LA22: "returnable label route",
  LA23: "perishable label window",
  LA24: "regulated label policy",
};

/** Description of a label code, or "unknown label code: <code>". */
export function describeLabel(code: string): string {
  return LABEL_CODES[code] ?? `unknown label code: ${code}`;
}

/** label codes are upper-case and prefixed with their kind. */
export function formatLabel(value: string): string {
  return "LAB-" + value.trim().toUpperCase();
}

/** Inverse of `formatLabel`; undefined when the prefix does not match. */
export function parseLabel(code: string): string | undefined {
  const prefix = "LAB-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the label limits (3 to 111). */
export function isLabelValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 111;
}

export function clampLabel(n: number): number {
  return Math.min(111, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 12, b: 13, c: 14 };

/** Relative weight of a label class; unknown classes weigh nothing. */
export function labelWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalLabelWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + labelWeight(key), 0);
}
