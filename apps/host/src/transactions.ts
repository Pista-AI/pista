// Pure parsing of pasted transactions (bank site, spreadsheet, CSV) and matching of a merchant to saved playbooks. No I/O.
import { parseAmounts, parseDates, type CandidateDate } from "@pista/pi-browser";

export type ParsedLine = { lineNo: number; raw: string; date?: string; amount?: number; currency?: string; merchant?: string; ok: boolean; reason?: string };
export type VendorMatch = { kind: "one"; site: string } | { kind: "none" } | { kind: "many"; sites: string[] };

type Col = "date" | "amount" | "merchant" | "currency";
const HEADER_NAMES: Record<Col, string[]> = {
  date: ["date", "datum", "bokforingsdatum", "transaktionsdatum"],
  amount: ["amount", "belopp"],
  merchant: ["description", "text", "beskrivning", "mottagare", "merchant"],
  currency: ["currency", "valuta"],
};
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const colOf = (cell: string): Col | undefined => {
  const n = strip(cell).toLowerCase().trim();
  return (Object.keys(HEADER_NAMES) as Col[]).find((c) => HEADER_NAMES[c].includes(n));
};

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

function findHeader(lines: string[]): { delim: string; cols: (Col | undefined)[]; index: number } | undefined {
  const index = lines.findIndex((l) => l.trim());
  if (index < 0) return undefined;
  for (const delim of ["\t", ";", ","]) {
    const cols = splitCells(lines[index]!, delim).map(colOf);
    if (new Set(cols.filter(Boolean)).size >= 2) return { delim, cols, index };
  }
  return undefined;
}

/** Numeric d/m order the whole paste uses, when some date can only be read one way; null when nothing says (never guessed). */
function pasteOrder(texts: string[]): "dmy" | "mdy" | null {
  let dmy = false, mdy = false;
  for (const t of texts) {
    for (const m of t.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g)) {
      if (+m[1]! > 12) dmy = true;
      if (+m[2]! > 12) mdy = true;
    }
  }
  return dmy === mdy ? null : dmy ? "dmy" : "mdy";
}

const iso = (d: CandidateDate) => `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;

/** Dates in `text` with the paste's d/m order applied: how many, the first one, and the matched spans to remove. */
function dates(text: string, order: "dmy" | "mdy" | null) {
  const found = parseDates(text).filter((d) => d.d !== undefined && (!d.amb || !order || d.amb === order));
  const ambiguous = found.some((d) => d.amb && !order);
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

function finish(base: Omit<ParsedLine, "ok" | "reason">, nDates: number, nAmounts: number, ambiguous: boolean): ParsedLine {
  const reason = nDates !== 1 ? (nDates ? "more than one date" : "no date")
    : ambiguous ? "ambiguous date"
    : nAmounts !== 1 ? (nAmounts ? "more than one amount" : "no amount")
    : base.amount! < 0 ? "negative amount (refund or credit)"
    : !base.merchant ? "no merchant text" : undefined;
  return reason ? { ...base, ok: false, reason } : { ...base, ok: true };
}

export function parseTransactions(text: string): { lines: ParsedLine[] } {
  const rows = text.replace(/[−–]/g, "-").split(/\r?\n/);
  const header = findHeader(rows);
  const body = rows.map((raw, i) => ({ raw, lineNo: i + 1 })).filter((r) => r.raw.trim() && (!header || r.lineNo - 1 > header.index));
  const col = (k: Col) => header?.cols.indexOf(k) ?? -1;
  const cells = (raw: string) => splitCells(raw, header!.delim);
  const order = pasteOrder(body.map((r) => (header ? (col("date") >= 0 ? cells(r.raw)[col("date")] ?? "" : "") : r.raw)));
  const lines: ParsedLine[] = [];
  for (const r of body) {
    if (header) {
      const c = cells(r.raw), cell = (k: Col) => (col(k) >= 0 ? c[col(k)] ?? "" : "");
      const d = dates(cell("date"), order), amounts = parseAmounts(cell("amount"));
      if (!d.count && !amounts.length) continue;
      const currency = cell("currency").toUpperCase() || (amounts[0]?.currency === "KR" ? undefined : amounts[0]?.currency);
      lines.push(finish({ lineNo: r.lineNo, raw: r.raw, date: d.date, amount: amounts[0]?.value, currency: currency || undefined, merchant: cleanMerchant(cell("merchant")) || undefined }, d.count, amounts.length, d.ambiguous));
      continue;
    }
    const d = dates(r.raw, order);
    const rest = removeRaws(r.raw, d.raws);
    const amounts = parseAmounts(rest, { strict: true });
    if (!d.count && !amounts.length) continue;
    const merchant = cleanMerchant(removeAmounts(rest));
    lines.push(finish({ lineNo: r.lineNo, raw: r.raw, date: d.date, amount: amounts[0]?.value, currency: amounts[0]?.currency === "KR" ? undefined : amounts[0]?.currency, merchant: merchant || undefined }, d.count, amounts.length, d.ambiguous));
  }
  return { lines };
}

const PROCESSOR_PREFIX = /^(?:SQ|TST|PAYPAL|PP|SP|IZ)\s*\*\s*/;
const normMerchant = (s: string) => strip(s).toUpperCase().replace(/\s+/g, " ").trim().replace(PROCESSOR_PREFIX, "");

/** Whole-word keyword match against the merchant; several sites never resolve to a guess. */
export function matchVendor(merchant: string, playbooks: { site: string; merchants?: string[] }[]): VendorMatch {
  const m = normMerchant(merchant);
  const sites = new Set<string>();
  for (const p of playbooks) {
    for (const k of p.merchants ?? []) {
      const kw = normMerchant(k);
      if (kw && new RegExp(`(?<![A-Z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Z0-9])`).test(m)) sites.add(p.site);
    }
  }
  const all = [...sites];
  return all.length === 1 ? { kind: "one", site: all[0]! } : all.length ? { kind: "many", sites: all } : { kind: "none" };
}
