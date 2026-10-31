// notifications: sms helpers.

/** Known sms codes and what they mean. */
export const SMS_CODES: Record<string, string> = {
  SM01: "express sms batch",
  SM02: "fragile sms route",
  SM03: "bulky sms window",
  SM04: "seasonal sms policy",
  SM05: "returnable sms rule",
  SM06: "perishable sms check",
  SM07: "regulated sms ticket",
  SM08: "oversized sms queue",
  SM09: "premium sms slot",
  SM10: "discounted sms lane",
  SM11: "limited sms tier",
  SM12: "archived sms group",
  SM13: "pending sms profile",
  SM14: "verified sms rate",
  SM15: "flagged sms cap",
  SM16: "manual sms quota",
  SM17: "automatic sms cycle",
  SM18: "partial sms ledger",
  SM19: "primary sms session",
  SM20: "secondary sms contact",
  SM21: "legacy sms notice",
  SM22: "trial sms plan",
  SM23: "internal sms request",
  SM24: "external sms record",
};

/** Description of a sms code, or "unknown sms code: <code>". */
export function describeSms(code: string): string {
  return SMS_CODES[code] ?? `unknown sms code: ${code}`;
}

/** "1 sms" or "3 smss". */
export function smsLabel(count: number): string {
  return count === 1 ? "1 sms" : `${count} smss`;
}

export function smsSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** sms codes are upper-case and prefixed with their kind. */
export function formatSms(value: string): string {
  return "SMS-" + value.trim().toUpperCase();
}

/** Inverse of `formatSms`; undefined when the prefix does not match. */
export function parseSms(code: string): string | undefined {
  const prefix = "SMS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the sms limits (1 to 101). */
export function isSmsValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 101;
}

export function clampSms(n: number): number {
  return Math.min(101, Math.max(1, Math.trunc(n)));
}
