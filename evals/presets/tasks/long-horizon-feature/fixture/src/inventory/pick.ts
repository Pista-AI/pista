// inventory: pick helpers.

/** Known pick codes and what they mean. */
export const PICK_CODES: Record<string, string> = {
  PI01: "external pick contact",
  PI02: "priority pick notice",
  PI03: "deferred pick plan",
  PI04: "standard pick request",
  PI05: "express pick record",
  PI06: "fragile pick entry",
  PI07: "bulky pick batch",
  PI08: "seasonal pick route",
  PI09: "returnable pick window",
  PI10: "perishable pick policy",
  PI11: "regulated pick rule",
  PI12: "oversized pick check",
  PI13: "premium pick ticket",
  PI14: "discounted pick queue",
  PI15: "limited pick slot",
  PI16: "archived pick lane",
  PI17: "pending pick tier",
  PI18: "verified pick group",
  PI19: "flagged pick profile",
  PI20: "manual pick rate",
  PI21: "automatic pick cap",
  PI22: "partial pick quota",
  PI23: "primary pick cycle",
  PI24: "secondary pick ledger",
};

/** Description of a pick code, or "unknown pick code: <code>". */
export function describePick(code: string): string {
  return PICK_CODES[code] ?? `unknown pick code: ${code}`;
}

/** Scales a pick amount by the module factor and rounds to a whole number. */
export function pickScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function pickShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 pick" or "3 picks". */
export function pickLabel(count: number): string {
  return count === 1 ? "1 pick" : `${count} picks`;
}

export function pickSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** pick codes are upper-case and prefixed with their kind. */
export function formatPick(value: string): string {
  return "PIC-" + value.trim().toUpperCase();
}

/** Inverse of `formatPick`; undefined when the prefix does not match. */
export function parsePick(code: string): string | undefined {
  const prefix = "PIC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
