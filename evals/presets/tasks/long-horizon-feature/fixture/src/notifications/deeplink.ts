// notifications: deeplink helpers.

/** Known deeplink codes and what they mean. */
export const DEEPLINK_CODES: Record<string, string> = {
  DE01: "premium deeplink check",
  DE02: "discounted deeplink ticket",
  DE03: "limited deeplink queue",
  DE04: "archived deeplink slot",
  DE05: "pending deeplink lane",
  DE06: "verified deeplink tier",
  DE07: "flagged deeplink group",
  DE08: "manual deeplink profile",
  DE09: "automatic deeplink rate",
  DE10: "partial deeplink cap",
  DE11: "primary deeplink quota",
  DE12: "secondary deeplink cycle",
  DE13: "legacy deeplink ledger",
  DE14: "trial deeplink session",
  DE15: "internal deeplink contact",
  DE16: "external deeplink notice",
  DE17: "priority deeplink plan",
  DE18: "deferred deeplink request",
  DE19: "standard deeplink record",
  DE20: "express deeplink entry",
  DE21: "fragile deeplink batch",
  DE22: "bulky deeplink route",
  DE23: "seasonal deeplink window",
  DE24: "returnable deeplink policy",
};

/** Description of a deeplink code, or "unknown deeplink code: <code>". */
export function describeDeeplink(code: string): string {
  return DEEPLINK_CODES[code] ?? `unknown deeplink code: ${code}`;
}

/** "1 deeplink" or "3 deeplinks". */
export function deeplinkLabel(count: number): string {
  return count === 1 ? "1 deeplink" : `${count} deeplinks`;
}

export function deeplinkSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** deeplink codes are upper-case and prefixed with their kind. */
export function formatDeeplink(value: string): string {
  return "DEE-" + value.trim().toUpperCase();
}

/** Inverse of `formatDeeplink`; undefined when the prefix does not match. */
export function parseDeeplink(code: string): string | undefined {
  const prefix = "DEE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the deeplink limits (0 to 136). */
export function isDeeplinkValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 136;
}

export function clampDeeplink(n: number): number {
  return Math.min(136, Math.max(0, Math.trunc(n)));
}
