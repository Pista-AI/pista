// billing: authorize helpers.

/** Known authorize codes and what they mean. */
export const AUTHORIZE_CODES: Record<string, string> = {
  AU01: "perishable authorize quota",
  AU02: "regulated authorize cycle",
  AU03: "oversized authorize ledger",
  AU04: "premium authorize session",
  AU05: "discounted authorize contact",
  AU06: "limited authorize notice",
  AU07: "archived authorize plan",
  AU08: "pending authorize request",
  AU09: "verified authorize record",
  AU10: "flagged authorize entry",
  AU11: "manual authorize batch",
  AU12: "automatic authorize route",
  AU13: "partial authorize window",
  AU14: "primary authorize policy",
  AU15: "secondary authorize rule",
  AU16: "legacy authorize check",
  AU17: "trial authorize ticket",
  AU18: "internal authorize queue",
  AU19: "external authorize slot",
  AU20: "priority authorize lane",
  AU21: "deferred authorize tier",
  AU22: "standard authorize group",
  AU23: "express authorize profile",
  AU24: "fragile authorize rate",
};

/** Description of a authorize code, or "unknown authorize code: <code>". */
export function describeAuthorize(code: string): string {
  return AUTHORIZE_CODES[code] ?? `unknown authorize code: ${code}`;
}

/** Scales a authorize amount by the module factor and rounds to a whole number. */
export function authorizeScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function authorizeShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 authorize" or "3 authorizes". */
export function authorizeLabel(count: number): string {
  return count === 1 ? "1 authorize" : `${count} authorizes`;
}

export function authorizeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** authorize codes are upper-case and prefixed with their kind. */
export function formatAuthorize(value: string): string {
  return "AUT-" + value.trim().toUpperCase();
}

/** Inverse of `formatAuthorize`; undefined when the prefix does not match. */
export function parseAuthorize(code: string): string | undefined {
  const prefix = "AUT-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
