import { addDays, isWeekend } from "../calendar/weekdays.ts";

/** Supplier deliveries arrive on weekdays only. Planned for the restock dashboard that was never built. */
export function nextRestockDate(from: Date): Date {
  let day = addDays(from, 3);
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}
