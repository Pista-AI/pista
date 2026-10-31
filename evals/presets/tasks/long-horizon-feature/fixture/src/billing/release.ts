// billing: release helpers.

/** Known release codes and what they mean. */
export const RELEASE_CODES: Record<string, string> = {
  RE01: "discounted release slot",
  RE02: "limited release lane",
  RE03: "archived release tier",
  RE04: "pending release group",
  RE05: "verified release profile",
  RE06: "flagged release rate",
  RE07: "manual release cap",
  RE08: "automatic release quota",
  RE09: "partial release cycle",
  RE10: "primary release ledger",
  RE11: "secondary release session",
  RE12: "legacy release contact",
  RE13: "trial release notice",
  RE14: "internal release plan",
  RE15: "external release request",
  RE16: "priority release record",
  RE17: "deferred release entry",
  RE18: "standard release batch",
  RE19: "express release route",
  RE20: "fragile release window",
  RE21: "bulky release policy",
  RE22: "seasonal release rule",
  RE23: "returnable release check",
  RE24: "perishable release ticket",
};

/** Description of a release code, or "unknown release code: <code>". */
export function describeRelease(code: string): string {
  return RELEASE_CODES[code] ?? `unknown release code: ${code}`;
}

/** "1 release" or "3 releases". */
export function releaseLabel(count: number): string {
  return count === 1 ? "1 release" : `${count} releases`;
}

export function releaseSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** release codes are upper-case and prefixed with their kind. */
export function formatRelease(value: string): string {
  return "REL-" + value.trim().toUpperCase();
}

/** Inverse of `formatRelease`; undefined when the prefix does not match. */
export function parseRelease(code: string): string | undefined {
  const prefix = "REL-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the release limits (1 to 137). */
export function isReleaseValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 137;
}

export function clampRelease(n: number): number {
  return Math.min(137, Math.max(1, Math.trunc(n)));
}
