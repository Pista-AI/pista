// inventory: audit helpers.

/** Known audit codes and what they mean. */
export const AUDIT_CODES: Record<string, string> = {
  AU01: "legacy audit tier",
  AU02: "trial audit group",
  AU03: "internal audit profile",
  AU04: "external audit rate",
  AU05: "priority audit cap",
  AU06: "deferred audit quota",
  AU07: "standard audit cycle",
  AU08: "express audit ledger",
  AU09: "fragile audit session",
  AU10: "bulky audit contact",
  AU11: "seasonal audit notice",
  AU12: "returnable audit plan",
  AU13: "perishable audit request",
  AU14: "regulated audit record",
  AU15: "oversized audit entry",
  AU16: "premium audit batch",
  AU17: "discounted audit route",
  AU18: "limited audit window",
  AU19: "archived audit policy",
  AU20: "pending audit rule",
  AU21: "verified audit check",
  AU22: "flagged audit ticket",
  AU23: "manual audit queue",
  AU24: "automatic audit slot",
};

/** Description of a audit code, or "unknown audit code: <code>". */
export function describeAudit(code: string): string {
  return AUDIT_CODES[code] ?? `unknown audit code: ${code}`;
}

/** audit codes are upper-case and prefixed with their kind. */
export function formatAudit(value: string): string {
  return "AUD-" + value.trim().toUpperCase();
}

/** Inverse of `formatAudit`; undefined when the prefix does not match. */
export function parseAudit(code: string): string | undefined {
  const prefix = "AUD-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the audit limits (1 to 121). */
export function isAuditValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 121;
}

export function clampAudit(n: number): number {
  return Math.min(121, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 22, b: 23, c: 24 };

/** Relative weight of a audit class; unknown classes weigh nothing. */
export function auditWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalAuditWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + auditWeight(key), 0);
}
