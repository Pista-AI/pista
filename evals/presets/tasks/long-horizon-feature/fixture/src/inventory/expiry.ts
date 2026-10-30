// inventory: expiry helpers.

/** Known expiry codes and what they mean. */
export const EXPIRY_CODES: Record<string, string> = {
  EX01: "fragile expiry lane",
  EX02: "bulky expiry tier",
  EX03: "seasonal expiry group",
  EX04: "returnable expiry profile",
  EX05: "perishable expiry rate",
  EX06: "regulated expiry cap",
  EX07: "oversized expiry quota",
  EX08: "premium expiry cycle",
  EX09: "discounted expiry ledger",
  EX10: "limited expiry session",
  EX11: "archived expiry contact",
  EX12: "pending expiry notice",
  EX13: "verified expiry plan",
  EX14: "flagged expiry request",
  EX15: "manual expiry record",
  EX16: "automatic expiry entry",
  EX17: "partial expiry batch",
  EX18: "primary expiry route",
  EX19: "secondary expiry window",
  EX20: "legacy expiry policy",
  EX21: "trial expiry rule",
  EX22: "internal expiry check",
  EX23: "external expiry ticket",
  EX24: "priority expiry queue",
};

/** Description of a expiry code, or "unknown expiry code: <code>". */
export function describeExpiry(code: string): string {
  return EXPIRY_CODES[code] ?? `unknown expiry code: ${code}`;
}

/** Scales a expiry amount by the module factor and rounds to a whole number. */
export function expiryScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function expiryShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 expiry" or "3 expirys". */
export function expiryLabel(count: number): string {
  return count === 1 ? "1 expiry" : `${count} expirys`;
}

export function expirySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** expiry codes are upper-case and prefixed with their kind. */
export function formatExpiry(value: string): string {
  return "EXP-" + value.trim().toUpperCase();
}

/** Inverse of `formatExpiry`; undefined when the prefix does not match. */
export function parseExpiry(code: string): string | undefined {
  const prefix = "EXP-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
