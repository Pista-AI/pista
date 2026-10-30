import { groupBy } from "./aggregate.ts";
import { dayOf } from "./dates.ts";

export interface MonthRow {
  month: string;
  /** How many orders were placed in the month (a count, not the orders). */
  orders: number;
  totalCents: number;
}

/** Sales per UTC calendar month (YYYY-MM), cancelled orders ignored, sorted by month ascending. */
export function salesByMonth(orders: { placedAt: string; totalCents: number; status?: string }[]): MonthRow[] {
  const groups = groupBy(orders.filter((o) => o.status !== "cancelled"), (o) => dayOf(o.placedAt).slice(0, 7));
  return [...groups.keys()].sort().map((month) => {
    const list = groups.get(month)!;
    return { month, orders: list.length, totalCents: list.reduce((sum, o) => sum + o.totalCents, 0) };
  });
}
