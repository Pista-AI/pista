export interface ReportEntry {
  date: Date;
  customer: string;
  note: string;
  amountCents: number;
}

export interface MonthlyReport {
  month: string; // "2026-03"
  entries: ReportEntry[];
}
