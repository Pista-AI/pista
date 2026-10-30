import { isPositiveInt, padNumber } from "./numbers.ts";

export function formatInvoiceNumber(year: number, seq: number): string {
  if (!isPositiveInt(seq) || seq > 999999) throw new RangeError(`invalid invoice sequence: ${seq}`);
  return `INV-${year}-${padNumber(seq, 6)}`;
}

export function parseInvoiceNumber(text: string): { year: number; seq: number } | null {
  const m = /^INV-(\d{4})-(\d{6})$/.exec(text);
  if (!m) return null;
  const seq = Number(m[2]);
  return seq >= 1 ? { year: Number(m[1]), seq } : null;
}
