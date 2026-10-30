// notifications: roster helpers.

/** Known roster codes and what they mean. */
export const ROSTER_CODES: Record<string, string> = {
  RO01: "deferred roster batch",
  RO02: "standard roster route",
  RO03: "express roster window",
  RO04: "fragile roster policy",
  RO05: "bulky roster rule",
  RO06: "seasonal roster check",
  RO07: "returnable roster ticket",
  RO08: "perishable roster queue",
  RO09: "regulated roster slot",
  RO10: "oversized roster lane",
  RO11: "premium roster tier",
  RO12: "discounted roster group",
  RO13: "limited roster profile",
  RO14: "archived roster rate",
  RO15: "pending roster cap",
  RO16: "verified roster quota",
  RO17: "flagged roster cycle",
  RO18: "manual roster ledger",
  RO19: "automatic roster session",
  RO20: "partial roster contact",
  RO21: "primary roster notice",
  RO22: "secondary roster plan",
  RO23: "legacy roster request",
  RO24: "trial roster record",
};

/** Description of a roster code, or "unknown roster code: <code>". */
export function describeRoster(code: string): string {
  return ROSTER_CODES[code] ?? `unknown roster code: ${code}`;
}

/** "1 roster" or "3 rosters". */
export function rosterLabel(count: number): string {
  return count === 1 ? "1 roster" : `${count} rosters`;
}

export function rosterSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** roster codes are upper-case and prefixed with their kind. */
export function formatRoster(value: string): string {
  return "ROS-" + value.trim().toUpperCase();
}

/** Inverse of `formatRoster`; undefined when the prefix does not match. */
export function parseRoster(code: string): string | undefined {
  const prefix = "ROS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the roster limits (2 to 126). */
export function isRosterValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 126;
}

export function clampRoster(n: number): number {
  return Math.min(126, Math.max(2, Math.trunc(n)));
}
