import { groupBy } from "./aggregate.ts";
import { dayOf } from "./dates.ts";

export function salesByDay(orders: { placedAt: string; totalCents: number; status?: string }[]): { day: string; orders: number; totalCents: number }[] {
  const groups = groupBy(orders.filter((o) => o.status !== "cancelled"), (o) => dayOf(o.placedAt));
  return [...groups.entries()]
    .map(([day, list]) => ({ day, orders: list.length, totalCents: list.reduce((s, o) => s + o.totalCents, 0) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
