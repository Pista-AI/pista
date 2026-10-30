// notifications: inbox helpers.

/** Known inbox codes and what they mean. */
export const INBOX_CODES: Record<string, string> = {
  IN01: "perishable inbox quota",
  IN02: "regulated inbox cycle",
  IN03: "oversized inbox ledger",
  IN04: "premium inbox session",
  IN05: "discounted inbox contact",
  IN06: "limited inbox notice",
  IN07: "archived inbox plan",
  IN08: "pending inbox request",
  IN09: "verified inbox record",
  IN10: "flagged inbox entry",
  IN11: "manual inbox batch",
  IN12: "automatic inbox route",
  IN13: "partial inbox window",
  IN14: "primary inbox policy",
  IN15: "secondary inbox rule",
  IN16: "legacy inbox check",
  IN17: "trial inbox ticket",
  IN18: "internal inbox queue",
  IN19: "external inbox slot",
  IN20: "priority inbox lane",
  IN21: "deferred inbox tier",
  IN22: "standard inbox group",
  IN23: "express inbox profile",
  IN24: "fragile inbox rate",
};

/** Description of a inbox code, or "unknown inbox code: <code>". */
export function describeInbox(code: string): string {
  return INBOX_CODES[code] ?? `unknown inbox code: ${code}`;
}

/** "1 inbox" or "3 inboxs". */
export function inboxLabel(count: number): string {
  return count === 1 ? "1 inbox" : `${count} inboxs`;
}

export function inboxSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** inbox codes are upper-case and prefixed with their kind. */
export function formatInbox(value: string): string {
  return "INB-" + value.trim().toUpperCase();
}

/** Inverse of `formatInbox`; undefined when the prefix does not match. */
export function parseInbox(code: string): string | undefined {
  const prefix = "INB-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the inbox limits (2 to 106). */
export function isInboxValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 106;
}

export function clampInbox(n: number): number {
  return Math.min(106, Math.max(2, Math.trunc(n)));
}
