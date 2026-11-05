import { PlaybookTrace } from "./playbook-capture.ts";

export type TraceEntry = Parameters<PlaybookTrace["add"]>[0];

/** A trace holding `entries` in order (entry numbers start at 1), with the invoice in context when given. */
export function traceOf(entries: readonly TraceEntry[], invoice?: unknown): PlaybookTrace {
  const t = new PlaybookTrace();
  for (const e of entries) t.add(e);
  if (invoice) t.invoice = invoice;
  return t;
}

/** Two entries on the local fixture server: 1 the list page, 2 a download by address. */
export const localListTrace = (): PlaybookTrace =>
  traceOf([
    { kind: "navigate", url: "http://127.0.0.1:8765/invoices/list.html" },
    { kind: "download", source: "url", url: "http://127.0.0.1:8765/invoices/a.pdf", contentType: "application/pdf", path: "invoices/a.pdf" },
  ]);
