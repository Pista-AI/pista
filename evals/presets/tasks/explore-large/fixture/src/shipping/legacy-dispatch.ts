import { addDays, isWeekend, startOfDay } from "../calendar/weekdays.ts";

/**
 * @deprecated Replaced by `dispatchDate` in dispatch.ts when the warehouse moved to a 14:00 cutoff.
 * Nothing imports this any more; kept until the old EDI export is deleted.
 */
export function legacyDispatchDate(placedAt: Date): Date {
  let day = addDays(startOfDay(placedAt), placedAt.getUTCHours() >= 12 ? 1 : 0);
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}
