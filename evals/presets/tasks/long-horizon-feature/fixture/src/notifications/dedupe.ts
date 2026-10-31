// notifications: dedupe helpers.

/** Known dedupe codes and what they mean. */
export const DEDUPE_CODES: Record<string, string> = {
  DE01: "seasonal dedupe quota",
  DE02: "returnable dedupe cycle",
  DE03: "perishable dedupe ledger",
  DE04: "regulated dedupe session",
  DE05: "oversized dedupe contact",
  DE06: "premium dedupe notice",
  DE07: "discounted dedupe plan",
  DE08: "limited dedupe request",
  DE09: "archived dedupe record",
  DE10: "pending dedupe entry",
  DE11: "verified dedupe batch",
  DE12: "flagged dedupe route",
  DE13: "manual dedupe window",
  DE14: "automatic dedupe policy",
  DE15: "partial dedupe rule",
  DE16: "primary dedupe check",
  DE17: "secondary dedupe ticket",
  DE18: "legacy dedupe queue",
  DE19: "trial dedupe slot",
  DE20: "internal dedupe lane",
  DE21: "external dedupe tier",
  DE22: "priority dedupe group",
  DE23: "deferred dedupe profile",
  DE24: "standard dedupe rate",
};

/** Description of a dedupe code, or "unknown dedupe code: <code>". */
export function describeDedupe(code: string): string {
  return DEDUPE_CODES[code] ?? `unknown dedupe code: ${code}`;
}

/** "1 dedupe" or "3 dedupes". */
export function dedupeLabel(count: number): string {
  return count === 1 ? "1 dedupe" : `${count} dedupes`;
}

export function dedupeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** dedupe codes are upper-case and prefixed with their kind. */
export function formatDedupe(value: string): string {
  return "DED-" + value.trim().toUpperCase();
}

/** Inverse of `formatDedupe`; undefined when the prefix does not match. */
export function parseDedupe(code: string): string | undefined {
  const prefix = "DED-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the dedupe limits (3 to 131). */
export function isDedupeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 131;
}

export function clampDedupe(n: number): number {
  return Math.min(131, Math.max(3, Math.trunc(n)));
}
