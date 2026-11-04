// Pure parsing of pasted transactions (bank site, spreadsheet, CSV) and matching of a merchant to saved playbooks. No I/O.
import { parseAmounts, parseDates, type CandidateDate } from "@pista/pi-browser";
import type { Playbook } from "@pista/protocol";
import { normaliseMerchant } from "./merchants.ts";

export type ParsedLine = { lineNo: number; raw: string; date?: string; amount?: number; currency?: string; merchant?: string; ok: boolean; reason?: string };
export type VendorMatch = { kind: "one"; site: string } | { kind: "none" } | { kind: "many"; sites: string[] };

type Col = "date" | "amount" | "merchant" | "currency";
// Lower rank wins when a header names several columns of one kind: the purchase date beats the booking date beats the value date.
// Balance columns (saldo, balance) are not listed, so they are never read as the amount.
const HEADER_NAMES: Record<Col, [string, number][]> = {
  date: [["transaktionsdatum", 0], ["transaction date", 0], ["kopdatum", 0], ["purchase date", 0], ["bokforingsdatum", 1], ["booking date", 1], ["posting date", 1], ["date", 1], ["datum", 1], ["valutadatum", 2], ["value date", 2]],
  amount: [["amount", 0], ["belopp", 0]],
  merchant: [["description", 0], ["text", 0], ["beskrivning", 0], ["mottagare", 0], ["merchant", 0]],
  currency: [["currency", 0], ["valuta", 0]],
};
const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const colOf = (cell: string): { col: Col; rank: number } | undefined => {
  const n = strip(cell).toLowerCase().replace(/[_\s]+/g, " ").trim();
  for (const col of Object.keys(HEADER_NAMES) as Col[]) {
    const hit = HEADER_NAMES[col].find(([name]) => name === n);
    if (hit) return { col, rank: hit[1] };
  }
  return undefined;
};
const isHeaderLine = (line: string) => ["\t", ";", ","].some((d) => new Set(splitCells(line, d).map((c) => colOf(c)?.col).filter(Boolean)).size >= 2);

/** Quote-aware split; quotes may wrap a cell and "" is a literal quote. */
function splitCells(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

type Header = { delim: string; index: number; pick: Record<Col, number>; unclear: { date: boolean; amount: boolean } };
function findHeader(lines: string[]): Header | undefined {
  const index = lines.findIndex((l) => l.trim());
  if (index < 0) return undefined;
  for (const delim of ["\t", ";", ","]) {
    const cells = splitCells(lines[index]!, delim).map(colOf);
    if (new Set(cells.map((c) => c?.col).filter(Boolean)).size < 2) continue;
    const pick = {} as Record<Col, number>;
    const unclear = { date: false, amount: false };
    for (const col of ["date", "amount", "merchant", "currency"] as Col[]) {
      const best = Math.min(...cells.map((c) => (c?.col === col ? c.rank : 9)));
      const at = cells.flatMap((c, i) => (c?.col === col && c.rank === best ? [i] : []));
      pick[col] = at.length ? at[0]! : -1;
      if ((col === "date" || col === "amount") && at.length > 1) unclear[col] = true;
    }
    return { delim, index, pick, unclear };
  }
  return undefined;
}

/** Numeric d/m order the whole paste uses, when some date can only be read one way; null when nothing says (never guessed). */
function pasteOrder(texts: string[]): "dmy" | "mdy" | null {
  let dmy = false, mdy = false;
  for (const t of texts) {
    for (const m of t.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/g)) {
      if (+m[1]! > 12) dmy = true;
      if (+m[2]! > 12) mdy = true;
    }
  }
  return dmy === mdy ? null : dmy ? "dmy" : "mdy";
}

const TWO_DIGIT_YEAR = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2}$/;
const iso = (d: CandidateDate) => `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;

/** Dates in `text` with the paste's d/m order applied: how many, the first one, and the matched spans to remove. */
function dates(text: string, order: "dmy" | "mdy" | null) {
  const found = parseDates(text).filter((d) => d.d !== undefined && (!d.amb || !order || d.amb === order));
  // A two-digit year (24-01-13, 13.01.24) cannot be told from another order, so it is never trusted.
  const ambiguous = found.some((d) => (d.amb && !order) || TWO_DIGIT_YEAR.test(d.raw));
  const count = found.filter((d) => !d.amb || !!order).length + found.filter((d) => d.amb && !order).length / 2;
  return { count, ambiguous, date: ambiguous ? undefined : found[0] && iso(found[0]), raws: [...new Set(found.map((d) => d.raw))] };
}

/** Removes `raws` (matched on the accent-stripped, lower-cased text, as parseDates reports them) from `text`. */
function removeRaws(text: string, raws: string[]): string {
  let out = [...text];
  for (const raw of raws) {
    let flat = "";
    const at: number[] = [];
    out.forEach((ch, i) => { for (const f of strip(ch).toLowerCase()) { at.push(i); flat += f; } });
    const p = flat.indexOf(raw);
    if (p >= 0) out.splice(at[p]!, at[p + raw.length - 1]! - at[p]! + 1, " ");
  }
  return out.join("");
}

const KNOWN_CUR = new Set<string>((Intl as any).supportedValuesOf?.("currency") ?? ["EUR", "USD", "GBP", "SEK", "NOK", "DKK", "CHF"]);
const NUM = String.raw`\d{1,3}(?:[   ]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CUR = String.raw`€|\$|£|\bkr\b|\b[A-Z]{3}\b`;
const AMOUNT_TEXT = new RegExp(`(?:(${CUR})\\s*)?[-(]?\\s?(?:${NUM})-?\\)?(?:\\s*(${CUR}))?`, "g");

/** Removes amount and currency tokens that parseAmounts accepts; a three-letter word that is not a currency (LLC) stays. */
function removeAmounts(text: string): string {
  return text.replace(AMOUNT_TEXT, (m, a?: string, b?: string) => {
    if (parseAmounts(m, { strict: true }).length !== 1) return m;
    const keep = [a, b].filter((c) => c && c.length === 3 && !KNOWN_CUR.has(c));
    return keep.length ? ` ${keep.join(" ")} ` : " ";
  });
}

const cleanMerchant = (s: string) => s.replace(/["\t;|]/g, " ").replace(/\s+/g, " ").replace(/^[\s,.:\-–]+|[\s,.:\-–]+$/g, "");

function finish(base: Omit<ParsedLine, "ok" | "reason">, nDates: number, nAmounts: number, unclear: string | false): ParsedLine {
  const reason = nDates !== 1 ? (nDates ? "more than one date" : "no date")
    : unclear ? unclear
    : nAmounts !== 1 ? (nAmounts ? "more than one amount" : "no amount")
    : !base.merchant ? "no merchant text" : undefined;
  return reason ? { ...base, ok: false, reason } : { ...base, ok: true };
}

/** "kr" alone does not say which krona, so the currency stays unknown. */
const knownCurrency = (c?: string) => (c && KNOWN_CUR.has(c.toUpperCase()) ? c.toUpperCase() : undefined);

/**
 * Sign convention of the paste. A lone line is a purchase when positive. Otherwise a convention is inferred only from a clear
 * majority (at least 3 lines, at least 2/3 one sign): the majority sign is an expense (returned positive), the other sign is a
 * refund or credit. With fewer lines, a tie or a weak mix nothing is inferred and every line is "unclear sign".
 */
function applySigns(lines: ParsedLine[]): void {
  const ok = lines.filter((l) => l.ok);
  const neg = ok.filter((l) => l.amount! < 0).length, pos = ok.length - neg;
  const reject = (l: ParsedLine, reason: string) => Object.assign(l, { ok: false, reason });
  if (ok.length === 1) {
    if (neg) reject(ok[0]!, "refund or credit (negative amount)");
    return;
  }
  const expensesNegative = ok.length >= 3 && neg * 3 >= ok.length * 2 ? true : ok.length >= 3 && pos * 3 >= ok.length * 2 ? false : undefined;
  for (const l of ok) {
    if (expensesNegative === undefined) reject(l, "unclear sign");
    else if (l.amount! < 0 === expensesNegative) l.amount = Math.abs(l.amount!);
    else reject(l, "refund or credit (amount sign differs from the other lines)");
  }
}

export function parseTransactions(text: string): { lines: ParsedLine[] } {
  const rows = text.replace(/[−–]/g, "-").split(/\r?\n/);
  const header = findHeader(rows);
  // Blank lines and header rows (including a repeated one) are not transactions.
  const body = rows.map((raw, i) => ({ raw, lineNo: i + 1 })).filter((r) => r.raw.trim() && (!header || r.lineNo - 1 > header.index) && !isHeaderLine(r.raw));
  const cells = (raw: string) => splitCells(raw, header!.delim);
  const order = pasteOrder(body.map((r) => (header ? (header.pick.date >= 0 ? cells(r.raw)[header.pick.date] ?? "" : "") : r.raw)));
  const lines: ParsedLine[] = [];
  for (const r of body) {
    if (header) {
      const c = cells(r.raw), cell = (k: Col) => (header.pick[k] >= 0 ? c[header.pick[k]] ?? "" : "");
      const d = dates(cell("date"), order), amounts = parseAmounts(cell("amount"));
      const unclear = header.unclear.date ? "ambiguous date column" : d.ambiguous ? "ambiguous date" : header.unclear.amount ? "ambiguous amount column" : false;
      const currency = cell("currency").trim() ? knownCurrency(cell("currency")) : knownCurrency(amounts[0]?.currency);
      lines.push(finish({ lineNo: r.lineNo, raw: r.raw, date: d.date, amount: amounts[0]?.value, currency, merchant: cleanMerchant(cell("merchant")) || undefined }, d.count, amounts.length, unclear));
      continue;
    }
    const d = dates(r.raw, order);
    const rest = removeRaws(r.raw, d.raws);
    const amounts = parseAmounts(rest, { strict: true });
    if (!d.count && !amounts.length) { lines.push({ lineNo: r.lineNo, raw: r.raw, ok: false, reason: "no date or amount" }); continue; }
    const merchant = cleanMerchant(removeAmounts(rest));
    lines.push(finish({ lineNo: r.lineNo, raw: r.raw, date: d.date, amount: amounts[0]?.value, currency: knownCurrency(amounts[0]?.currency), merchant: merchant || undefined }, d.count, amounts.length, d.ambiguous && "ambiguous date"));
  }
  applySigns(lines);
  return { lines };
}

const norm = (s: string) => normaliseMerchant(s).replace(/\s+/g, " ").trim();

/** Whole-word match of confirmed merchant keywords (never merchantsPending) against the merchant; several sites never resolve to a guess. */
export function matchVendor(merchant: string, playbooks: Pick<Playbook, "site" | "merchants">[]): VendorMatch {
  const m = norm(merchant);
  const sites = new Set<string>();
  for (const p of playbooks) {
    for (const k of p.merchants ?? []) {
      const kw = norm(k);
      if (kw && new RegExp(`(?<![\\p{L}\\p{N}])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(m)) sites.add(p.site);
    }
  }
  const all = [...sites];
  return all.length === 1 ? { kind: "one", site: all[0]! } : all.length ? { kind: "many", sites: all } : { kind: "none" };
}
