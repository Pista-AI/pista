// orders: parcel helpers.

/** Known parcel codes and what they mean. */
export const PARCEL_CODES: Record<string, string> = {
  PA01: "oversized parcel plan",
  PA02: "premium parcel request",
  PA03: "discounted parcel record",
  PA04: "limited parcel entry",
  PA05: "archived parcel batch",
  PA06: "pending parcel route",
  PA07: "verified parcel window",
  PA08: "flagged parcel policy",
  PA09: "manual parcel rule",
  PA10: "automatic parcel check",
  PA11: "partial parcel ticket",
  PA12: "primary parcel queue",
  PA13: "secondary parcel slot",
  PA14: "legacy parcel lane",
  PA15: "trial parcel tier",
  PA16: "internal parcel group",
  PA17: "external parcel profile",
  PA18: "priority parcel rate",
  PA19: "deferred parcel cap",
  PA20: "standard parcel quota",
  PA21: "express parcel cycle",
  PA22: "fragile parcel ledger",
  PA23: "bulky parcel session",
  PA24: "seasonal parcel contact",
};

/** Description of a parcel code, or "unknown parcel code: <code>". */
export function describeParcel(code: string): string {
  return PARCEL_CODES[code] ?? `unknown parcel code: ${code}`;
}

/** "1 parcel" or "3 parcels". */
export function parcelLabel(count: number): string {
  return count === 1 ? "1 parcel" : `${count} parcels`;
}

export function parcelSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** parcel codes are upper-case and prefixed with their kind. */
export function formatParcel(value: string): string {
  return "PAR-" + value.trim().toUpperCase();
}

/** Inverse of `formatParcel`; undefined when the prefix does not match. */
export function parseParcel(code: string): string | undefined {
  const prefix = "PAR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the parcel limits (0 to 108). */
export function isParcelValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 108;
}

export function clampParcel(n: number): number {
  return Math.min(108, Math.max(0, Math.trunc(n)));
}
