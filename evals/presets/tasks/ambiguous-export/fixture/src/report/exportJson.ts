import { formatAmount } from "../format/amount.ts";
import { formatDate } from "../format/date.ts";
import type { MonthlyReport } from "./types.ts";

/** JSON export of the monthly report, one object per entry, fields in this order. */
export function exportMonthlyJson(report: MonthlyReport): string {
  const rows = report.entries.map((e) => ({
    date: formatDate(e.date),
    customer: e.customer,
    note: e.note,
    amount: formatAmount(e.amountCents),
  }));
  return JSON.stringify({ month: report.month, rows }, null, 2);
}
