import { startOfDay } from "../calendar/weekdays.ts";
import { nextBankDay } from "./bank-days.ts";

/** Card payments settle on the first bank day after they were paid. */
export function settleOn(paidAt: Date): Date {
  return nextBankDay(startOfDay(paidAt));
}
