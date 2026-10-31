// reports: backlog helpers.

/** Known backlog codes and what they mean. */
export const BACKLOG_CODES: Record<string, string> = {
  BA01: "standard backlog policy",
  BA02: "express backlog rule",
  BA03: "fragile backlog check",
  BA04: "bulky backlog ticket",
  BA05: "seasonal backlog queue",
  BA06: "returnable backlog slot",
  BA07: "perishable backlog lane",
  BA08: "regulated backlog tier",
  BA09: "oversized backlog group",
  BA10: "premium backlog profile",
  BA11: "discounted backlog rate",
  BA12: "limited backlog cap",
  BA13: "archived backlog quota",
  BA14: "pending backlog cycle",
  BA15: "verified backlog ledger",
  BA16: "flagged backlog session",
  BA17: "manual backlog contact",
  BA18: "automatic backlog notice",
  BA19: "partial backlog plan",
  BA20: "primary backlog request",
  BA21: "secondary backlog record",
  BA22: "legacy backlog entry",
  BA23: "trial backlog batch",
  BA24: "internal backlog route",
};

/** Description of a backlog code, or "unknown backlog code: <code>". */
export function describeBacklog(code: string): string {
  return BACKLOG_CODES[code] ?? `unknown backlog code: ${code}`;
}

/** "1 backlog" or "3 backlogs". */
export function backlogLabel(count: number): string {
  return count === 1 ? "1 backlog" : `${count} backlogs`;
}

export function backlogSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** backlog codes are upper-case and prefixed with their kind. */
export function formatBacklog(value: string): string {
  return "BAC-" + value.trim().toUpperCase();
}

/** Inverse of `formatBacklog`; undefined when the prefix does not match. */
export function parseBacklog(code: string): string | undefined {
  const prefix = "BAC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the backlog limits (3 to 127). */
export function isBacklogValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 127;
}

export function clampBacklog(n: number): number {
  return Math.min(127, Math.max(3, Math.trunc(n)));
}
