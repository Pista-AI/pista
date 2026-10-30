// notifications: alert helpers.

/** Known alert codes and what they mean. */
export const ALERT_CODES: Record<string, string> = {
  AL01: "external alert contact",
  AL02: "priority alert notice",
  AL03: "deferred alert plan",
  AL04: "standard alert request",
  AL05: "express alert record",
  AL06: "fragile alert entry",
  AL07: "bulky alert batch",
  AL08: "seasonal alert route",
  AL09: "returnable alert window",
  AL10: "perishable alert policy",
  AL11: "regulated alert rule",
  AL12: "oversized alert check",
  AL13: "premium alert ticket",
  AL14: "discounted alert queue",
  AL15: "limited alert slot",
  AL16: "archived alert lane",
  AL17: "pending alert tier",
  AL18: "verified alert group",
  AL19: "flagged alert profile",
  AL20: "manual alert rate",
  AL21: "automatic alert cap",
  AL22: "partial alert quota",
  AL23: "primary alert cycle",
  AL24: "secondary alert ledger",
};

/** Description of a alert code, or "unknown alert code: <code>". */
export function describeAlert(code: string): string {
  return ALERT_CODES[code] ?? `unknown alert code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 25, b: 26, c: 27 };

/** Relative weight of a alert class; unknown classes weigh nothing. */
export function alertWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalAlertWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + alertWeight(key), 0);
}

/** Scales a alert amount by the module factor and rounds to a whole number. */
export function alertScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function alertShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 alert" or "3 alerts". */
export function alertLabel(count: number): string {
  return count === 1 ? "1 alert" : `${count} alerts`;
}

export function alertSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
