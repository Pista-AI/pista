// billing: renewal helpers.

/** Known renewal codes and what they mean. */
export const RENEWAL_CODES: Record<string, string> = {
  RE01: "trial renewal rate",
  RE02: "internal renewal cap",
  RE03: "external renewal quota",
  RE04: "priority renewal cycle",
  RE05: "deferred renewal ledger",
  RE06: "standard renewal session",
  RE07: "express renewal contact",
  RE08: "fragile renewal notice",
  RE09: "bulky renewal plan",
  RE10: "seasonal renewal request",
  RE11: "returnable renewal record",
  RE12: "perishable renewal entry",
  RE13: "regulated renewal batch",
  RE14: "oversized renewal route",
  RE15: "premium renewal window",
  RE16: "discounted renewal policy",
  RE17: "limited renewal rule",
  RE18: "archived renewal check",
  RE19: "pending renewal ticket",
  RE20: "verified renewal queue",
  RE21: "flagged renewal slot",
  RE22: "manual renewal lane",
  RE23: "automatic renewal tier",
  RE24: "partial renewal group",
};

/** Description of a renewal code, or "unknown renewal code: <code>". */
export function describeRenewal(code: string): string {
  return RENEWAL_CODES[code] ?? `unknown renewal code: ${code}`;
}

/** "1 renewal" or "3 renewals". */
export function renewalLabel(count: number): string {
  return count === 1 ? "1 renewal" : `${count} renewals`;
}

export function renewalSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** renewal codes are upper-case and prefixed with their kind. */
export function formatRenewal(value: string): string {
  return "REN-" + value.trim().toUpperCase();
}

/** Inverse of `formatRenewal`; undefined when the prefix does not match. */
export function parseRenewal(code: string): string | undefined {
  const prefix = "REN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the renewal limits (2 to 122). */
export function isRenewalValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 122;
}

export function clampRenewal(n: number): number {
  return Math.min(122, Math.max(2, Math.trunc(n)));
}
