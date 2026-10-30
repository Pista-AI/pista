// reports: snapshot helpers.

/** Known snapshot codes and what they mean. */
export const SNAPSHOT_CODES: Record<string, string> = {
  SN01: "seasonal snapshot quota",
  SN02: "returnable snapshot cycle",
  SN03: "perishable snapshot ledger",
  SN04: "regulated snapshot session",
  SN05: "oversized snapshot contact",
  SN06: "premium snapshot notice",
  SN07: "discounted snapshot plan",
  SN08: "limited snapshot request",
  SN09: "archived snapshot record",
  SN10: "pending snapshot entry",
  SN11: "verified snapshot batch",
  SN12: "flagged snapshot route",
  SN13: "manual snapshot window",
  SN14: "automatic snapshot policy",
  SN15: "partial snapshot rule",
  SN16: "primary snapshot check",
  SN17: "secondary snapshot ticket",
  SN18: "legacy snapshot queue",
  SN19: "trial snapshot slot",
  SN20: "internal snapshot lane",
  SN21: "external snapshot tier",
  SN22: "priority snapshot group",
  SN23: "deferred snapshot profile",
  SN24: "standard snapshot rate",
};

/** Description of a snapshot code, or "unknown snapshot code: <code>". */
export function describeSnapshot(code: string): string {
  return SNAPSHOT_CODES[code] ?? `unknown snapshot code: ${code}`;
}

/** Scales a snapshot amount by the module factor and rounds to a whole number. */
export function snapshotScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function snapshotShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 snapshot" or "3 snapshots". */
export function snapshotLabel(count: number): string {
  return count === 1 ? "1 snapshot" : `${count} snapshots`;
}

export function snapshotSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** snapshot codes are upper-case and prefixed with their kind. */
export function formatSnapshot(value: string): string {
  return "SNA-" + value.trim().toUpperCase();
}

/** Inverse of `formatSnapshot`; undefined when the prefix does not match. */
export function parseSnapshot(code: string): string | undefined {
  const prefix = "SNA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
