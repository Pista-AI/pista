// orders: locker helpers.

/** Known locker codes and what they mean. */
export const LOCKER_CODES: Record<string, string> = {
  LO01: "archived locker slot",
  LO02: "pending locker lane",
  LO03: "verified locker tier",
  LO04: "flagged locker group",
  LO05: "manual locker profile",
  LO06: "automatic locker rate",
  LO07: "partial locker cap",
  LO08: "primary locker quota",
  LO09: "secondary locker cycle",
  LO10: "legacy locker ledger",
  LO11: "trial locker session",
  LO12: "internal locker contact",
  LO13: "external locker notice",
  LO14: "priority locker plan",
  LO15: "deferred locker request",
  LO16: "standard locker record",
  LO17: "express locker entry",
  LO18: "fragile locker batch",
  LO19: "bulky locker route",
  LO20: "seasonal locker window",
  LO21: "returnable locker policy",
  LO22: "perishable locker rule",
  LO23: "regulated locker check",
  LO24: "oversized locker ticket",
};

/** Description of a locker code, or "unknown locker code: <code>". */
export function describeLocker(code: string): string {
  return LOCKER_CODES[code] ?? `unknown locker code: ${code}`;
}

/** Scales a locker amount by the module factor and rounds to a whole number. */
export function lockerScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function lockerShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 locker" or "3 lockers". */
export function lockerLabel(count: number): string {
  return count === 1 ? "1 locker" : `${count} lockers`;
}

export function lockerSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** locker codes are upper-case and prefixed with their kind. */
export function formatLocker(value: string): string {
  return "LOC-" + value.trim().toUpperCase();
}

/** Inverse of `formatLocker`; undefined when the prefix does not match. */
export function parseLocker(code: string): string | undefined {
  const prefix = "LOC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
