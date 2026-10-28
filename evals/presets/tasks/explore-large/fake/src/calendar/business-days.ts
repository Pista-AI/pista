import { isPublicHoliday } from "./holidays.ts";
import { addDays, isWeekend } from "./weekdays.ts";

/** Monday to Friday; with a `country`, that country's public holidays are days off too. */
export function isBusinessDay(date: Date, country?: string): boolean {
  return !isWeekend(date) && !(country !== undefined && isPublicHoliday(date, country));
}

/** `from` itself when it is a business day, otherwise the next one. */
export function nextBusinessDay(from: Date, country?: string): Date {
  let day = from;
  while (!isBusinessDay(day, country)) day = addDays(day, 1);
  return day;
}
