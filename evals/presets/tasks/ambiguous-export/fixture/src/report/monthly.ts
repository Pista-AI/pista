import type { MonthlyReport, ReportEntry } from "./types.ts";

/** Entries of one calendar month (UTC), oldest first. `month` is "YYYY-MM". */
export function buildMonthlyReport(month: string, entries: ReportEntry[]): MonthlyReport {
  const inMonth = entries.filter((e) => e.date.toISOString().startsWith(month));
  return { month, entries: [...inMonth].sort((a, b) => a.date.getTime() - b.date.getTime()) };
}

export function reportTotalCents(report: MonthlyReport): number {
  return report.entries.reduce((sum, e) => sum + e.amountCents, 0);
}
