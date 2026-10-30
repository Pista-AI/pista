// notifications: quiet helpers.

/** Known quiet codes and what they mean. */
export const QUIET_CODES: Record<string, string> = {
  QU01: "limited quiet check",
  QU02: "archived quiet ticket",
  QU03: "pending quiet queue",
  QU04: "verified quiet slot",
  QU05: "flagged quiet lane",
  QU06: "manual quiet tier",
  QU07: "automatic quiet group",
  QU08: "partial quiet profile",
  QU09: "primary quiet rate",
  QU10: "secondary quiet cap",
  QU11: "legacy quiet quota",
  QU12: "trial quiet cycle",
  QU13: "internal quiet ledger",
  QU14: "external quiet session",
  QU15: "priority quiet contact",
  QU16: "deferred quiet notice",
  QU17: "standard quiet plan",
  QU18: "express quiet request",
  QU19: "fragile quiet record",
  QU20: "bulky quiet entry",
  QU21: "seasonal quiet batch",
  QU22: "returnable quiet route",
  QU23: "perishable quiet window",
  QU24: "regulated quiet policy",
};

/** Description of a quiet code, or "unknown quiet code: <code>". */
export function describeQuiet(code: string): string {
  return QUIET_CODES[code] ?? `unknown quiet code: ${code}`;
}

/** "1 quiet" or "3 quiets". */
export function quietLabel(count: number): string {
  return count === 1 ? "1 quiet" : `${count} quiets`;
}

export function quietSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** quiet codes are upper-case and prefixed with their kind. */
export function formatQuiet(value: string): string {
  return "QUI-" + value.trim().toUpperCase();
}

/** Inverse of `formatQuiet`; undefined when the prefix does not match. */
export function parseQuiet(code: string): string | undefined {
  const prefix = "QUI-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the quiet limits (3 to 111). */
export function isQuietValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 111;
}

export function clampQuiet(n: number): number {
  return Math.min(111, Math.max(3, Math.trunc(n)));
}
