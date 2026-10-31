// notifications: webhook helpers.

/** Known webhook codes and what they mean. */
export const WEBHOOK_CODES: Record<string, string> = {
  WE01: "regulated webhook session",
  WE02: "oversized webhook contact",
  WE03: "premium webhook notice",
  WE04: "discounted webhook plan",
  WE05: "limited webhook request",
  WE06: "archived webhook record",
  WE07: "pending webhook entry",
  WE08: "verified webhook batch",
  WE09: "flagged webhook route",
  WE10: "manual webhook window",
  WE11: "automatic webhook policy",
  WE12: "partial webhook rule",
  WE13: "primary webhook check",
  WE14: "secondary webhook ticket",
  WE15: "legacy webhook queue",
  WE16: "trial webhook slot",
  WE17: "internal webhook lane",
  WE18: "external webhook tier",
  WE19: "priority webhook group",
  WE20: "deferred webhook profile",
  WE21: "standard webhook rate",
  WE22: "express webhook cap",
  WE23: "fragile webhook quota",
  WE24: "bulky webhook cycle",
};

/** Description of a webhook code, or "unknown webhook code: <code>". */
export function describeWebhook(code: string): string {
  return WEBHOOK_CODES[code] ?? `unknown webhook code: ${code}`;
}

/** webhook codes are upper-case and prefixed with their kind. */
export function formatWebhook(value: string): string {
  return "WEB-" + value.trim().toUpperCase();
}

/** Inverse of `formatWebhook`; undefined when the prefix does not match. */
export function parseWebhook(code: string): string | undefined {
  const prefix = "WEB-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the webhook limits (3 to 107). */
export function isWebhookValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 107;
}

export function clampWebhook(n: number): number {
  return Math.min(107, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 8, b: 9, c: 10 };

/** Relative weight of a webhook class; unknown classes weigh nothing. */
export function webhookWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalWebhookWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + webhookWeight(key), 0);
}
