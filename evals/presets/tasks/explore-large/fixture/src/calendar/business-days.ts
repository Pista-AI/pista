import { addDays, isWeekend } from "./weekdays.ts";

/** Monday to Friday. Public holidays are not considered here. */
export function isBusinessDay(date: Date): boolean {
  return !isWeekend(date);
}

/** `from` itself when it is a business day, otherwise the next one. */
export function nextBusinessDay(from: Date): Date {
  let day = from;
  while (!isBusinessDay(day)) day = addDays(day, 1);
  return day;
}
