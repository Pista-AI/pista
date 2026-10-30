// notifications: unsubscribe helpers.

/** Known unsubscribe codes and what they mean. */
export const UNSUBSCRIBE_CODES: Record<string, string> = {
  UN01: "manual unsubscribe notice",
  UN02: "automatic unsubscribe plan",
  UN03: "partial unsubscribe request",
  UN04: "primary unsubscribe record",
  UN05: "secondary unsubscribe entry",
  UN06: "legacy unsubscribe batch",
  UN07: "trial unsubscribe route",
  UN08: "internal unsubscribe window",
  UN09: "external unsubscribe policy",
  UN10: "priority unsubscribe rule",
  UN11: "deferred unsubscribe check",
  UN12: "standard unsubscribe ticket",
  UN13: "express unsubscribe queue",
  UN14: "fragile unsubscribe slot",
  UN15: "bulky unsubscribe lane",
  UN16: "seasonal unsubscribe tier",
  UN17: "returnable unsubscribe group",
  UN18: "perishable unsubscribe profile",
  UN19: "regulated unsubscribe rate",
  UN20: "oversized unsubscribe cap",
  UN21: "premium unsubscribe quota",
  UN22: "discounted unsubscribe cycle",
  UN23: "limited unsubscribe ledger",
  UN24: "archived unsubscribe session",
};

/** Description of a unsubscribe code, or "unknown unsubscribe code: <code>". */
export function describeUnsubscribe(code: string): string {
  return UNSUBSCRIBE_CODES[code] ?? `unknown unsubscribe code: ${code}`;
}

/** "1 unsubscribe" or "3 unsubscribes". */
export function unsubscribeLabel(count: number): string {
  return count === 1 ? "1 unsubscribe" : `${count} unsubscribes`;
}

export function unsubscribeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** unsubscribe codes are upper-case and prefixed with their kind. */
export function formatUnsubscribe(value: string): string {
  return "UNS-" + value.trim().toUpperCase();
}

/** Inverse of `formatUnsubscribe`; undefined when the prefix does not match. */
export function parseUnsubscribe(code: string): string | undefined {
  const prefix = "UNS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the unsubscribe limits (0 to 116). */
export function isUnsubscribeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 116;
}

export function clampUnsubscribe(n: number): number {
  return Math.min(116, Math.max(0, Math.trunc(n)));
}
