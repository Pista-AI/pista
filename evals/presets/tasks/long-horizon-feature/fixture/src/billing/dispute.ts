// billing: dispute helpers.

/** Known dispute codes and what they mean. */
export const DISPUTE_CODES: Record<string, string> = {
  DI01: "regulated dispute session",
  DI02: "oversized dispute contact",
  DI03: "premium dispute notice",
  DI04: "discounted dispute plan",
  DI05: "limited dispute request",
  DI06: "archived dispute record",
  DI07: "pending dispute entry",
  DI08: "verified dispute batch",
  DI09: "flagged dispute route",
  DI10: "manual dispute window",
  DI11: "automatic dispute policy",
  DI12: "partial dispute rule",
  DI13: "primary dispute check",
  DI14: "secondary dispute ticket",
  DI15: "legacy dispute queue",
  DI16: "trial dispute slot",
  DI17: "internal dispute lane",
  DI18: "external dispute tier",
  DI19: "priority dispute group",
  DI20: "deferred dispute profile",
  DI21: "standard dispute rate",
  DI22: "express dispute cap",
  DI23: "fragile dispute quota",
  DI24: "bulky dispute cycle",
};

/** Description of a dispute code, or "unknown dispute code: <code>". */
export function describeDispute(code: string): string {
  return DISPUTE_CODES[code] ?? `unknown dispute code: ${code}`;
}

/** "1 dispute" or "3 disputes". */
export function disputeLabel(count: number): string {
  return count === 1 ? "1 dispute" : `${count} disputes`;
}

export function disputeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** dispute codes are upper-case and prefixed with their kind. */
export function formatDispute(value: string): string {
  return "DIS-" + value.trim().toUpperCase();
}

/** Inverse of `formatDispute`; undefined when the prefix does not match. */
export function parseDispute(code: string): string | undefined {
  const prefix = "DIS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the dispute limits (3 to 107). */
export function isDisputeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 107;
}

export function clampDispute(n: number): number {
  return Math.min(107, Math.max(3, Math.trunc(n)));
}
