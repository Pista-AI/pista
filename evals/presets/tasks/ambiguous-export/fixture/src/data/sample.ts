import type { ReportEntry } from "../report/types.ts";

export const SAMPLE_ENTRIES: ReportEntry[] = [
  { date: new Date("2026-03-02T09:15:00Z"), customer: "Astrid Berg", note: "Annual licence", amountCents: 249000 },
  { date: new Date("2026-03-09T13:40:00Z"), customer: "Fjord AS", note: "Support hours", amountCents: 87550 },
  { date: new Date("2026-03-21T08:05:00Z"), customer: "Nordlys Kaffe", note: "Setup fee", amountCents: 12000 },
  { date: new Date("2026-04-01T10:00:00Z"), customer: "Astrid Berg", note: "Renewal", amountCents: 249000 },
];
