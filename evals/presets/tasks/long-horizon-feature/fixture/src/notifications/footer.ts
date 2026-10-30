// notifications: footer helpers.

/** Known footer codes and what they mean. */
export const FOOTER_CODES: Record<string, string> = {
  FO01: "primary footer rule",
  FO02: "secondary footer check",
  FO03: "legacy footer ticket",
  FO04: "trial footer queue",
  FO05: "internal footer slot",
  FO06: "external footer lane",
  FO07: "priority footer tier",
  FO08: "deferred footer group",
  FO09: "standard footer profile",
  FO10: "express footer rate",
  FO11: "fragile footer cap",
  FO12: "bulky footer quota",
  FO13: "seasonal footer cycle",
  FO14: "returnable footer ledger",
  FO15: "perishable footer session",
  FO16: "regulated footer contact",
  FO17: "oversized footer notice",
  FO18: "premium footer plan",
  FO19: "discounted footer request",
  FO20: "limited footer record",
  FO21: "archived footer entry",
  FO22: "pending footer batch",
  FO23: "verified footer route",
  FO24: "flagged footer window",
};

/** Description of a footer code, or "unknown footer code: <code>". */
export function describeFooter(code: string): string {
  return FOOTER_CODES[code] ?? `unknown footer code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 20, b: 21, c: 22 };

/** Relative weight of a footer class; unknown classes weigh nothing. */
export function footerWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalFooterWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + footerWeight(key), 0);
}

/** Scales a footer amount by the module factor and rounds to a whole number. */
export function footerScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function footerShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 footer" or "3 footers". */
export function footerLabel(count: number): string {
  return count === 1 ? "1 footer" : `${count} footers`;
}

export function footerSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
