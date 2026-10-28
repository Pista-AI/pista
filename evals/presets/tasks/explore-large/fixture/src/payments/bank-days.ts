import { isBusinessDay } from "../calendar/business-days.ts";
import { isoDate } from "../calendar/format.ts";
import { addDays } from "../calendar/weekdays.ts";

/** Days the clearing house is closed, set by the bank, not the public-holiday calendar. */
export const BANK_HOLIDAYS = ["2026-01-01", "2026-04-03", "2026-04-06", "2026-12-25", "2026-12-26"];

export function isBankDay(date: Date): boolean {
  return isBusinessDay(date) && !BANK_HOLIDAYS.includes(isoDate(date));
}

/** The first bank day after `date`. */
export function nextBankDay(date: Date): Date {
  let day = addDays(date, 1);
  while (!isBankDay(day)) day = addDays(day, 1);
  return day;
}
