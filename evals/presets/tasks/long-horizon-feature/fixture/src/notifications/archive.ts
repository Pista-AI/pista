// notifications: archive helpers.

/** Known archive codes and what they mean. */
export const ARCHIVE_CODES: Record<string, string> = {
  AR01: "returnable archive session",
  AR02: "perishable archive contact",
  AR03: "regulated archive notice",
  AR04: "oversized archive plan",
  AR05: "premium archive request",
  AR06: "discounted archive record",
  AR07: "limited archive entry",
  AR08: "archived archive batch",
  AR09: "pending archive route",
  AR10: "verified archive window",
  AR11: "flagged archive policy",
  AR12: "manual archive rule",
  AR13: "automatic archive check",
  AR14: "partial archive ticket",
  AR15: "primary archive queue",
  AR16: "secondary archive slot",
  AR17: "legacy archive lane",
  AR18: "trial archive tier",
  AR19: "internal archive group",
  AR20: "external archive profile",
  AR21: "priority archive rate",
  AR22: "deferred archive cap",
  AR23: "standard archive quota",
  AR24: "express archive cycle",
};

/** Description of a archive code, or "unknown archive code: <code>". */
export function describeArchive(code: string): string {
  return ARCHIVE_CODES[code] ?? `unknown archive code: ${code}`;
}

/** archive codes are upper-case and prefixed with their kind. */
export function formatArchive(value: string): string {
  return "ARC-" + value.trim().toUpperCase();
}

/** Inverse of `formatArchive`; undefined when the prefix does not match. */
export function parseArchive(code: string): string | undefined {
  const prefix = "ARC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the archive limits (0 to 132). */
export function isArchiveValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 132;
}

export function clampArchive(n: number): number {
  return Math.min(132, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 33, b: 34, c: 35 };

/** Relative weight of a archive class; unknown classes weigh nothing. */
export function archiveWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalArchiveWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + archiveWeight(key), 0);
}
