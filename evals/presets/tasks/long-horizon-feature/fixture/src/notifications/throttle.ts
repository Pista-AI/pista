// notifications: throttle helpers.

/** Known throttle codes and what they mean. */
export const THROTTLE_CODES: Record<string, string> = {
  TH01: "bulky throttle profile",
  TH02: "seasonal throttle rate",
  TH03: "returnable throttle cap",
  TH04: "perishable throttle quota",
  TH05: "regulated throttle cycle",
  TH06: "oversized throttle ledger",
  TH07: "premium throttle session",
  TH08: "discounted throttle contact",
  TH09: "limited throttle notice",
  TH10: "archived throttle plan",
  TH11: "pending throttle request",
  TH12: "verified throttle record",
  TH13: "flagged throttle entry",
  TH14: "manual throttle batch",
  TH15: "automatic throttle route",
  TH16: "partial throttle window",
  TH17: "primary throttle policy",
  TH18: "secondary throttle rule",
  TH19: "legacy throttle check",
  TH20: "trial throttle ticket",
  TH21: "internal throttle queue",
  TH22: "external throttle slot",
  TH23: "priority throttle lane",
  TH24: "deferred throttle tier",
};

/** Description of a throttle code, or "unknown throttle code: <code>". */
export function describeThrottle(code: string): string {
  return THROTTLE_CODES[code] ?? `unknown throttle code: ${code}`;
}

/** Scales a throttle amount by the module factor and rounds to a whole number. */
export function throttleScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function throttleShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 throttle" or "3 throttles". */
export function throttleLabel(count: number): string {
  return count === 1 ? "1 throttle" : `${count} throttles`;
}

export function throttleSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** throttle codes are upper-case and prefixed with their kind. */
export function formatThrottle(value: string): string {
  return "THR-" + value.trim().toUpperCase();
}

/** Inverse of `formatThrottle`; undefined when the prefix does not match. */
export function parseThrottle(code: string): string | undefined {
  const prefix = "THR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
