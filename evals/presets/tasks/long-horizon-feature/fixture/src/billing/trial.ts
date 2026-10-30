// billing: trial helpers.

/** Known trial codes and what they mean. */
export const TRIAL_CODES: Record<string, string> = {
  TR01: "legacy trial tier",
  TR02: "trial trial group",
  TR03: "internal trial profile",
  TR04: "external trial rate",
  TR05: "priority trial cap",
  TR06: "deferred trial quota",
  TR07: "standard trial cycle",
  TR08: "express trial ledger",
  TR09: "fragile trial session",
  TR10: "bulky trial contact",
  TR11: "seasonal trial notice",
  TR12: "returnable trial plan",
  TR13: "perishable trial request",
  TR14: "regulated trial record",
  TR15: "oversized trial entry",
  TR16: "premium trial batch",
  TR17: "discounted trial route",
  TR18: "limited trial window",
  TR19: "archived trial policy",
  TR20: "pending trial rule",
  TR21: "verified trial check",
  TR22: "flagged trial ticket",
  TR23: "manual trial queue",
  TR24: "automatic trial slot",
};

/** Description of a trial code, or "unknown trial code: <code>". */
export function describeTrial(code: string): string {
  return TRIAL_CODES[code] ?? `unknown trial code: ${code}`;
}

/** Scales a trial amount by the module factor and rounds to a whole number. */
export function trialScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function trialShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 trial" or "3 trials". */
export function trialLabel(count: number): string {
  return count === 1 ? "1 trial" : `${count} trials`;
}

export function trialSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** trial codes are upper-case and prefixed with their kind. */
export function formatTrial(value: string): string {
  return "TRI-" + value.trim().toUpperCase();
}

/** Inverse of `formatTrial`; undefined when the prefix does not match. */
export function parseTrial(code: string): string | undefined {
  const prefix = "TRI-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
