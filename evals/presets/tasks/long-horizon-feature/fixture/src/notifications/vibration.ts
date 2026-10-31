// notifications: vibration helpers.

/** Known vibration codes and what they mean. */
export const VIBRATION_CODES: Record<string, string> = {
  VI01: "oversized vibration window",
  VI02: "premium vibration policy",
  VI03: "discounted vibration rule",
  VI04: "limited vibration check",
  VI05: "archived vibration ticket",
  VI06: "pending vibration queue",
  VI07: "verified vibration slot",
  VI08: "flagged vibration lane",
  VI09: "manual vibration tier",
  VI10: "automatic vibration group",
  VI11: "partial vibration profile",
  VI12: "primary vibration rate",
  VI13: "secondary vibration cap",
  VI14: "legacy vibration quota",
  VI15: "trial vibration cycle",
  VI16: "internal vibration ledger",
  VI17: "external vibration session",
  VI18: "priority vibration contact",
  VI19: "deferred vibration notice",
  VI20: "standard vibration plan",
  VI21: "express vibration request",
  VI22: "fragile vibration record",
  VI23: "bulky vibration entry",
  VI24: "seasonal vibration batch",
};

/** Description of a vibration code, or "unknown vibration code: <code>". */
export function describeVibration(code: string): string {
  return VIBRATION_CODES[code] ?? `unknown vibration code: ${code}`;
}

/** Scales a vibration amount by the module factor and rounds to a whole number. */
export function vibrationScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function vibrationShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 vibration" or "3 vibrations". */
export function vibrationLabel(count: number): string {
  return count === 1 ? "1 vibration" : `${count} vibrations`;
}

export function vibrationSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** vibration codes are upper-case and prefixed with their kind. */
export function formatVibration(value: string): string {
  return "VIB-" + value.trim().toUpperCase();
}

/** Inverse of `formatVibration`; undefined when the prefix does not match. */
export function parseVibration(code: string): string | undefined {
  const prefix = "VIB-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
