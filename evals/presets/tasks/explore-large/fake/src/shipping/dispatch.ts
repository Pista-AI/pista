import { nextBusinessDay } from "../calendar/business-days.ts";
import { addDays, startOfDay } from "../calendar/weekdays.ts";

/** Orders placed from this UTC hour on are picked the next day. */
export const CUTOFF_HOUR_UTC = 14;

/** The day (00:00 UTC) an order placed at `placedAt` and shipped to `country` leaves the warehouse. */
export function dispatchDate(placedAt: Date, country: string): Date {
  const day = startOfDay(placedAt);
  const start = placedAt.getUTCHours() >= CUTOFF_HOUR_UTC ? addDays(day, 1) : day;
  return nextBusinessDay(start, country);
}
