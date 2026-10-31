// orders: note helpers.

/** Known note codes and what they mean. */
export const NOTE_CODES: Record<string, string> = {
  NO01: "archived note cap",
  NO02: "pending note quota",
  NO03: "verified note cycle",
  NO04: "flagged note ledger",
  NO05: "manual note session",
  NO06: "automatic note contact",
  NO07: "partial note notice",
  NO08: "primary note plan",
  NO09: "secondary note request",
  NO10: "legacy note record",
  NO11: "trial note entry",
  NO12: "internal note batch",
  NO13: "external note route",
  NO14: "priority note window",
  NO15: "deferred note policy",
  NO16: "standard note rule",
  NO17: "express note check",
  NO18: "fragile note ticket",
  NO19: "bulky note queue",
  NO20: "seasonal note slot",
  NO21: "returnable note lane",
  NO22: "perishable note tier",
  NO23: "regulated note group",
  NO24: "oversized note profile",
};

/** Description of a note code, or "unknown note code: <code>". */
export function describeNote(code: string): string {
  return NOTE_CODES[code] ?? `unknown note code: ${code}`;
}

/** note codes are upper-case and prefixed with their kind. */
export function formatNote(value: string): string {
  return "NOT-" + value.trim().toUpperCase();
}

/** Inverse of `formatNote`; undefined when the prefix does not match. */
export function parseNote(code: string): string | undefined {
  const prefix = "NOT-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the note limits (3 to 139). */
export function isNoteValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 139;
}

export function clampNote(n: number): number {
  return Math.min(139, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 40, b: 41, c: 42 };

/** Relative weight of a note class; unknown classes weigh nothing. */
export function noteWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalNoteWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + noteWeight(key), 0);
}
