// reports: churn helpers.

/** Known churn codes and what they mean. */
export const CHURN_CODES: Record<string, string> = {
  CH01: "regulated churn session",
  CH02: "oversized churn contact",
  CH03: "premium churn notice",
  CH04: "discounted churn plan",
  CH05: "limited churn request",
  CH06: "archived churn record",
  CH07: "pending churn entry",
  CH08: "verified churn batch",
  CH09: "flagged churn route",
  CH10: "manual churn window",
  CH11: "automatic churn policy",
  CH12: "partial churn rule",
  CH13: "primary churn check",
  CH14: "secondary churn ticket",
  CH15: "legacy churn queue",
  CH16: "trial churn slot",
  CH17: "internal churn lane",
  CH18: "external churn tier",
  CH19: "priority churn group",
  CH20: "deferred churn profile",
  CH21: "standard churn rate",
  CH22: "express churn cap",
  CH23: "fragile churn quota",
  CH24: "bulky churn cycle",
};

/** Description of a churn code, or "unknown churn code: <code>". */
export function describeChurn(code: string): string {
  return CHURN_CODES[code] ?? `unknown churn code: ${code}`;
}

/** "1 churn" or "3 churns". */
export function churnLabel(count: number): string {
  return count === 1 ? "1 churn" : `${count} churns`;
}

export function churnSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** churn codes are upper-case and prefixed with their kind. */
export function formatChurn(value: string): string {
  return "CHU-" + value.trim().toUpperCase();
}

/** Inverse of `formatChurn`; undefined when the prefix does not match. */
export function parseChurn(code: string): string | undefined {
  const prefix = "CHU-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the churn limits (3 to 107). */
export function isChurnValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 107;
}

export function clampChurn(n: number): number {
  return Math.min(107, Math.max(3, Math.trunc(n)));
}
