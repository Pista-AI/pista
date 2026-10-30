// notifications: email helpers.

/** Known email codes and what they mean. */
export const EMAIL_CODES: Record<string, string> = {
  EM01: "standard email request",
  EM02: "express email record",
  EM03: "fragile email entry",
  EM04: "bulky email batch",
  EM05: "seasonal email route",
  EM06: "returnable email window",
  EM07: "perishable email policy",
  EM08: "regulated email rule",
  EM09: "oversized email check",
  EM10: "premium email ticket",
  EM11: "discounted email queue",
  EM12: "limited email slot",
  EM13: "archived email lane",
  EM14: "pending email tier",
  EM15: "verified email group",
  EM16: "flagged email profile",
  EM17: "manual email rate",
  EM18: "automatic email cap",
  EM19: "partial email quota",
  EM20: "primary email cycle",
  EM21: "secondary email ledger",
  EM22: "legacy email session",
  EM23: "trial email contact",
  EM24: "internal email notice",
};

/** Description of a email code, or "unknown email code: <code>". */
export function describeEmail(code: string): string {
  return EMAIL_CODES[code] ?? `unknown email code: ${code}`;
}

/** Scales a email amount by the module factor and rounds to a whole number. */
export function emailScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function emailShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 email" or "3 emails". */
export function emailLabel(count: number): string {
  return count === 1 ? "1 email" : `${count} emails`;
}

export function emailSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** email codes are upper-case and prefixed with their kind. */
export function formatEmail(value: string): string {
  return "EMA-" + value.trim().toUpperCase();
}

/** Inverse of `formatEmail`; undefined when the prefix does not match. */
export function parseEmail(code: string): string | undefined {
  const prefix = "EMA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
