// billing: audit-log helpers.

/** Known audit-log codes and what they mean. */
export const AUDIT_LOG_CODES: Record<string, string> = {
  AU01: "perishable audit-log plan",
  AU02: "regulated audit-log request",
  AU03: "oversized audit-log record",
  AU04: "premium audit-log entry",
  AU05: "discounted audit-log batch",
  AU06: "limited audit-log route",
  AU07: "archived audit-log window",
  AU08: "pending audit-log policy",
  AU09: "verified audit-log rule",
  AU10: "flagged audit-log check",
  AU11: "manual audit-log ticket",
  AU12: "automatic audit-log queue",
  AU13: "partial audit-log slot",
  AU14: "primary audit-log lane",
  AU15: "secondary audit-log tier",
  AU16: "legacy audit-log group",
  AU17: "trial audit-log profile",
  AU18: "internal audit-log rate",
  AU19: "external audit-log cap",
  AU20: "priority audit-log quota",
  AU21: "deferred audit-log cycle",
  AU22: "standard audit-log ledger",
  AU23: "express audit-log session",
  AU24: "fragile audit-log contact",
};

/** Description of a audit-log code, or "unknown audit-log code: <code>". */
export function describeAuditLog(code: string): string {
  return AUDIT_LOG_CODES[code] ?? `unknown audit-log code: ${code}`;
}

/** audit-log codes are upper-case and prefixed with their kind. */
export function formatAuditLog(value: string): string {
  return "AUD-" + value.trim().toUpperCase();
}

/** Inverse of `formatAuditLog`; undefined when the prefix does not match. */
export function parseAuditLog(code: string): string | undefined {
  const prefix = "AUD-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the audit-log limits (1 to 133). */
export function isAuditLogValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 133;
}

export function clampAuditLog(n: number): number {
  return Math.min(133, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 34, b: 35, c: 36 };

/** Relative weight of a audit-log class; unknown classes weigh nothing. */
export function auditLogWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalAuditLogWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + auditLogWeight(key), 0);
}
