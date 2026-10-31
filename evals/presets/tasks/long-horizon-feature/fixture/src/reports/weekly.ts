// reports: weekly helpers.

/** Known weekly codes and what they mean. */
export const WEEKLY_CODES: Record<string, string> = {
  WE01: "express weekly batch",
  WE02: "fragile weekly route",
  WE03: "bulky weekly window",
  WE04: "seasonal weekly policy",
  WE05: "returnable weekly rule",
  WE06: "perishable weekly check",
  WE07: "regulated weekly ticket",
  WE08: "oversized weekly queue",
  WE09: "premium weekly slot",
  WE10: "discounted weekly lane",
  WE11: "limited weekly tier",
  WE12: "archived weekly group",
  WE13: "pending weekly profile",
  WE14: "verified weekly rate",
  WE15: "flagged weekly cap",
  WE16: "manual weekly quota",
  WE17: "automatic weekly cycle",
  WE18: "partial weekly ledger",
  WE19: "primary weekly session",
  WE20: "secondary weekly contact",
  WE21: "legacy weekly notice",
  WE22: "trial weekly plan",
  WE23: "internal weekly request",
  WE24: "external weekly record",
};

/** Description of a weekly code, or "unknown weekly code: <code>". */
export function describeWeekly(code: string): string {
  return WEEKLY_CODES[code] ?? `unknown weekly code: ${code}`;
}

/** Scales a weekly amount by the module factor and rounds to a whole number. */
export function weeklyScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function weeklyShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 weekly" or "3 weeklys". */
export function weeklyLabel(count: number): string {
  return count === 1 ? "1 weekly" : `${count} weeklys`;
}

export function weeklySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** weekly codes are upper-case and prefixed with their kind. */
export function formatWeekly(value: string): string {
  return "WEE-" + value.trim().toUpperCase();
}

/** Inverse of `formatWeekly`; undefined when the prefix does not match. */
export function parseWeekly(code: string): string | undefined {
  const prefix = "WEE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
