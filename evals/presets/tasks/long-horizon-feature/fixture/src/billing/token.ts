// billing: token helpers.

/** Known token codes and what they mean. */
export const TOKEN_CODES: Record<string, string> = {
  TO01: "standard token policy",
  TO02: "express token rule",
  TO03: "fragile token check",
  TO04: "bulky token ticket",
  TO05: "seasonal token queue",
  TO06: "returnable token slot",
  TO07: "perishable token lane",
  TO08: "regulated token tier",
  TO09: "oversized token group",
  TO10: "premium token profile",
  TO11: "discounted token rate",
  TO12: "limited token cap",
  TO13: "archived token quota",
  TO14: "pending token cycle",
  TO15: "verified token ledger",
  TO16: "flagged token session",
  TO17: "manual token contact",
  TO18: "automatic token notice",
  TO19: "partial token plan",
  TO20: "primary token request",
  TO21: "secondary token record",
  TO22: "legacy token entry",
  TO23: "trial token batch",
  TO24: "internal token route",
};

/** Description of a token code, or "unknown token code: <code>". */
export function describeToken(code: string): string {
  return TOKEN_CODES[code] ?? `unknown token code: ${code}`;
}

/** "1 token" or "3 tokens". */
export function tokenLabel(count: number): string {
  return count === 1 ? "1 token" : `${count} tokens`;
}

export function tokenSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** token codes are upper-case and prefixed with their kind. */
export function formatToken(value: string): string {
  return "TOK-" + value.trim().toUpperCase();
}

/** Inverse of `formatToken`; undefined when the prefix does not match. */
export function parseToken(code: string): string | undefined {
  const prefix = "TOK-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the token limits (3 to 127). */
export function isTokenValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 127;
}

export function clampToken(n: number): number {
  return Math.min(127, Math.max(3, Math.trunc(n)));
}
