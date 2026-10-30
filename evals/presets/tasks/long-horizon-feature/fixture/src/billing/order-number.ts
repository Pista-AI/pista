import { isPositiveInt, padNumber } from "./numbers.ts";

const ORDER_NUMBER = /^ORD-(\d{4})-(\d{5})$/;
const MAX_SEQ = 99999;

/** ORD-2026-00042 for (2026, 42): the sequence is zero-padded to five digits and must be 1 to 99999. */
export function formatOrderNumber(year: number, seq: number): string {
  if (!isPositiveInt(seq) || seq > MAX_SEQ) throw new RangeError(`order sequence out of range: ${seq}`);
  return `ORD-${year}-${padNumber(seq, 5)}`;
}

/** Strict inverse of `formatOrderNumber`: exact digit widths, upper-case prefix, no surrounding whitespace; null for anything else, sequence 0 included. */
export function parseOrderNumber(text: string): { year: number; seq: number } | null {
  const match = ORDER_NUMBER.exec(text);
  if (!match) return null;
  const seq = Number(match[2]);
  return seq === 0 ? null : { year: Number(match[1]), seq };
}
