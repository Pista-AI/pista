// billing: hold helpers.

/** Known hold codes and what they mean. */
export const HOLD_CODES: Record<string, string> = {
  HO01: "premium hold check",
  HO02: "discounted hold ticket",
  HO03: "limited hold queue",
  HO04: "archived hold slot",
  HO05: "pending hold lane",
  HO06: "verified hold tier",
  HO07: "flagged hold group",
  HO08: "manual hold profile",
  HO09: "automatic hold rate",
  HO10: "partial hold cap",
  HO11: "primary hold quota",
  HO12: "secondary hold cycle",
  HO13: "legacy hold ledger",
  HO14: "trial hold session",
  HO15: "internal hold contact",
  HO16: "external hold notice",
  HO17: "priority hold plan",
  HO18: "deferred hold request",
  HO19: "standard hold record",
  HO20: "express hold entry",
  HO21: "fragile hold batch",
  HO22: "bulky hold route",
  HO23: "seasonal hold window",
  HO24: "returnable hold policy",
};

/** Description of a hold code, or "unknown hold code: <code>". */
export function describeHold(code: string): string {
  return HOLD_CODES[code] ?? `unknown hold code: ${code}`;
}

/** Scales a hold amount by the module factor and rounds to a whole number. */
export function holdScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function holdShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 hold" or "3 holds". */
export function holdLabel(count: number): string {
  return count === 1 ? "1 hold" : `${count} holds`;
}

export function holdSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** hold codes are upper-case and prefixed with their kind. */
export function formatHold(value: string): string {
  return "HOL-" + value.trim().toUpperCase();
}

/** Inverse of `formatHold`; undefined when the prefix does not match. */
export function parseHold(code: string): string | undefined {
  const prefix = "HOL-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
