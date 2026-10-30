// inventory: warehouse helpers.

/** Known warehouse codes and what they mean. */
export const WAREHOUSE_CODES: Record<string, string> = {
  WA01: "standard warehouse request",
  WA02: "express warehouse record",
  WA03: "fragile warehouse entry",
  WA04: "bulky warehouse batch",
  WA05: "seasonal warehouse route",
  WA06: "returnable warehouse window",
  WA07: "perishable warehouse policy",
  WA08: "regulated warehouse rule",
  WA09: "oversized warehouse check",
  WA10: "premium warehouse ticket",
  WA11: "discounted warehouse queue",
  WA12: "limited warehouse slot",
  WA13: "archived warehouse lane",
  WA14: "pending warehouse tier",
  WA15: "verified warehouse group",
  WA16: "flagged warehouse profile",
  WA17: "manual warehouse rate",
  WA18: "automatic warehouse cap",
  WA19: "partial warehouse quota",
  WA20: "primary warehouse cycle",
  WA21: "secondary warehouse ledger",
  WA22: "legacy warehouse session",
  WA23: "trial warehouse contact",
  WA24: "internal warehouse notice",
};

/** Description of a warehouse code, or "unknown warehouse code: <code>". */
export function describeWarehouse(code: string): string {
  return WAREHOUSE_CODES[code] ?? `unknown warehouse code: ${code}`;
}

/** "1 warehouse" or "3 warehouses". */
export function warehouseLabel(count: number): string {
  return count === 1 ? "1 warehouse" : `${count} warehouses`;
}

export function warehouseSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** warehouse codes are upper-case and prefixed with their kind. */
export function formatWarehouse(value: string): string {
  return "WAR-" + value.trim().toUpperCase();
}

/** Inverse of `formatWarehouse`; undefined when the prefix does not match. */
export function parseWarehouse(code: string): string | undefined {
  const prefix = "WAR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the warehouse limits (0 to 100). */
export function isWarehouseValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 100;
}

export function clampWarehouse(n: number): number {
  return Math.min(100, Math.max(0, Math.trunc(n)));
}
