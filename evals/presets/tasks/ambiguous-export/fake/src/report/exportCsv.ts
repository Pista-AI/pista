import { formatAmount } from "../format/amount.ts";
import { formatDate } from "../format/date.ts";
import type { MonthlyReport } from "./types.ts";

const COLUMNS = ["date", "customer", "note", "amount"];

/** RFC 4180: quote a field when it holds a comma, a quote or a line break; double inner quotes. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** CSV export of the monthly report: header row, then one line per entry, same columns as the JSON export. */
export function exportMonthlyCsv(report: MonthlyReport): string {
  const lines = report.entries.map((e) =>
    [formatDate(e.date), e.customer, e.note, formatAmount(e.amountCents)].map(field).join(","),
  );
  return [COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}
