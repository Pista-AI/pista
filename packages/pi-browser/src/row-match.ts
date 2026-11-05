// Pure matcher: picks the invoice-list row a job is looking for. Output carries indices only (rows may hold personal data).

import { EUR_RATES, rateFor as fxRate } from "./fx.ts";

/** `amb` marks one reading of a numeric date that could be day-first or month-first; both readings are emitted. */
export type CandidateDate = { y: number; m: number; d?: number; monthOnly?: boolean; amb?: "dmy" | "mdy"; raw: string };
export type MatchRow = { index: number; text: string };
export type Amount = { value: number; currency?: string };

const DEFAULT_LOCALES = ["en", "sv", "de", "fr", "es", "nl", "da", "nb", "fi", "it", "pt"];
const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const tableCache = new Map<string, { map: Map<string, number>; alt: string }>();
function monthTable(locales: string[]) {
  const key = locales.join(",");
  let t = tableCache.get(key);
  if (t) return t;
  const map = new Map<string, number>([["sept", 9]]);
  for (const loc of locales) {
    for (const style of ["long", "short"] as const) {
      const f = new Intl.DateTimeFormat(loc, { month: style, timeZone: "UTC" });
      for (let m = 0; m < 12; m++) {
        const n = norm(f.format(new Date(Date.UTC(2026, m, 15)))).replace(/[^a-z]/g, "");
        if (n.length >= 3 && !map.has(n)) map.set(n, m + 1);
      }
    }
  }
  const alt = [...map.keys()].sort((a, b) => b.length - a.length).join("|");
  t = { map, alt };
  tableCache.set(key, t);
  return t;
}

const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m);
const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

export function parseDates(text: string, opts: { locales?: string[] } = {}): CandidateDate[] {
  const { map, alt } = monthTable(opts.locales ?? DEFAULT_LOCALES);
  const s = norm(text);
  const out: CandidateDate[] = [];
  const used: [number, number][] = [];
  const free = (a: number, b: number) => !used.some(([x, y]) => a < y && b > x);
  const run = (re: RegExp, f: (m: RegExpExecArray) => Omit<CandidateDate, "raw">[]) => {
    for (const m of s.matchAll(re)) {
      const a = m.index!, b = a + m[0].length;
      if (!free(a, b)) continue;
      const c = f(m as RegExpExecArray);
      if (!c.length) continue;
      used.push([a, b]);
      out.push(...c.map((x) => ({ ...x, raw: m[0] })));
    }
  };
  const full = (y: number, m: number, d: number) => (valid(y, m, d) ? [{ y, m, d }] : []);
  const dedupe = <T extends { m: number; d?: number }>(a: T[]) => a.filter((x, i) => a.findIndex((z) => z.m === x.m && z.d === x.d) === i);
  const mon = `(?<![a-z])(${alt})(?![a-z])`;
  run(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, (m) => full(+m[1], +m[2], +m[3]));
  run(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g, (m) => {
    const y = year(m[3]);
    const dmy = full(y, +m[2], +m[1]), mdy = full(y, +m[1], +m[2]);
    if (!dmy.length || !mdy.length || (dmy[0]!.m === mdy[0]!.m && dmy[0]!.d === mdy[0]!.d)) return [...dmy, ...mdy].slice(0, 1);
    return [{ ...dmy[0]!, amb: "dmy" as const }, { ...mdy[0]!, amb: "mdy" as const }];
  });
  run(new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s*${mon}\\.?,?\\s*(\\d{4})(?!\\d)`, "g"), (m) => full(+m[3], map.get(m[2])!, +m[1]));
  run(new RegExp(`${mon}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?!\\d),?\\s*(\\d{4})(?!\\d)`, "g"), (m) => full(+m[3], map.get(m[1])!, +m[2]));
  run(new RegExp(`${mon}\\.?,?\\s*(\\d{4})(?!\\d)`, "g"), (m) => [{ y: +m[2], m: map.get(m[1])!, monthOnly: true }]);
  return out;
}

const CURRENCIES = new Set<string>((Intl as any).supportedValuesOf?.("currency") ?? ["EUR", "USD", "GBP", "SEK", "NOK", "DKK", "CHF"]);
/** "kr" is a marker only: it does not say which krona, so it agrees with SEK, NOK, DKK and with no currency. */
const SYM: Record<string, string> = { "€": "EUR", "US$": "USD", $: "USD", "£": "GBP", kr: "KR" };
const KRONA = new Set(["KR", "SEK", "NOK", "DKK"]);
const NUM = String.raw`\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CUR = String.raw`€|US\$|\$|£|\bkr\b|\b[A-Z]{3}\b`;
// groups: 1 currency, 2 "(", 3 leading "-", 4 number, 5 trailing "-", 6 ")", 7 currency after
const AMOUNT_RE = new RegExp(`(?:(${CUR})\\s*)?(?:(\\()\\s*|(?<![\\w.,/])(-)\\s?|(?<![\\d.,/-]))(${NUM})(?![\\d/]|[.,]\\d|-\\w)(-(?!\\w))?(\\))?(?:\\s*(${CUR}))?`, "g");

function toNumber(raw: string): number {
  const s = raw.replace(/[ \u00a0\u202f]/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  const last = Math.max(lastDot, lastComma);
  if (last < 0) return Number(s);
  const tail = s.slice(last + 1);
  const count = s.split(s[last]).length - 1;
  const decimal = (lastDot >= 0 && lastComma >= 0) || (count === 1 && tail.length <= 2);
  return decimal ? Number(s.slice(0, last).replace(/[.,]/g, "") + "." + tail) : Number(s.replace(/[.,]/g, ""));
}

/**
 * Amounts in `text`. A leading or trailing "-" or parentheses make an amount negative. Times (14.30) without a currency are skipped.
 * `strict` keeps only amounts that carry a currency or decimals, so day and year numbers in dates are not read as amounts.
 */
export function parseAmounts(text: string, opts: { strict?: boolean } = {}): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const c = [m[1], m[7]].map((x) => x?.toLowerCase() === "kr" ? "kr" : x).find((x) => x && (SYM[x] || CURRENCIES.has(x)));
    if (!c && /^([01]?\d|2[0-3])[.:]([0-5]\d)$/.test(m[4]!)) continue;
    if (opts.strict && !c && !/[.,]\d{1,2}$/.test(m[4]!)) continue;
    let value = toNumber(m[4]!);
    if (m[3] || m[5] || (m[2] && m[6])) value = -value;
    if (Number.isFinite(value)) out.push(c ? { value, currency: SYM[c] ?? c } : { value });
  }
  return out;
}

const agrees = (a: string | undefined, t: string | undefined) => {
  const x = a?.toUpperCase(), y = t?.toUpperCase();
  return !x || !y || x === y || (KRONA.has(x) && KRONA.has(y));
};

const dayNum = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000);
const isoParts = (iso: string) => iso.split("-").map(Number) as [number, number, number];

/** The numeric order the list uses, when any date there is only valid one way (a part above 12); otherwise null. */
function listOrder(texts: string[]): "dmy" | "mdy" | null {
  let dmy = false, mdy = false;
  for (const t of texts) {
    for (const m of t.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g)) {
      if (+m[1]! > 12) dmy = true;
      if (+m[2]! > 12) mdy = true;
    }
  }
  return dmy === mdy ? null : dmy ? "dmy" : "mdy";
}
const readings = (text: string, order: "dmy" | "mdy" | null) =>
  parseDates(text).filter((d) => d.d !== undefined && (!d.amb || !order || d.amb === order)).map((d) => (order && d.amb ? { ...d, amb: undefined } : d));

/**
 * Sign convention: `target.date` is the bank transaction date and the rows are the vendor's invoices. `offsetDays` is
 * target date minus row date, so it is positive when the vendor's row comes before the charge (the normal case: invoice on the
 * 21st, charge on the 22nd is +1). The date score is full for 0 to +3, falls linearly to 0 at +7 (`maxBefore`), and for rows dated
 * after the charge (negative offsets) falls fast and ends at -2 (`maxAfter`).
 */
export type MatchOptions = {
  /** Days a row may precede the bank date (default 7) and follow it (default 2). */
  maxBefore?: number;
  maxAfter?: number;
  /** Relative width of the amount band: a row in another currency scores full inside it, 0 at twice it. Default 0.08 for the built-in table, 0.05 for caller rates (halved when two or more rows are in the window, never below 0.02). */
  band?: number;
  /** Rate source of the caller (for example learned per site); when given, `band` should come with it. */
  rateFor?: (from: string, to: string) => number | undefined;
  /** Units per EUR overriding entries of the built-in table. */
  rates?: Record<string, number>;
  /** Score gap to the runner-up below which the answer is "many" (default 0.15). */
  margin?: number;
};
/** The answer for period labels, which carry no scores. */
export type PeriodMatch = { kind: "one"; index: number } | { kind: "none" } | { kind: "many"; candidates: number[] };
export type MatchedBy = "date" | "amount" | "amount-fx" | "reference";
export type Candidate = {
  index: number;
  score: number;
  /** Bank date minus row date, in days: positive when the row precedes the charge. */
  offsetDays: number;
  date: { y: number; m: number; d: number };
  amount?: { value: number; currency?: string; score: number; rate?: number; converted?: number };
  reference?: true;
  /** The date is a guess (a numeric day/month reading, or a later date of a row that shows several): conclusive only with an exact amount or a reference. */
  guess?: true;
  /** The best date is not the earliest of several the row shows: it may be a due or paid date, so the row is never conclusive without a reference. */
  due?: true;
  matchedBy: MatchedBy[];
  amountVerified: boolean;
};
export type RowMatch =
  | ({ kind: "one"; index: number; fxRateUsed?: number; /** the matched row's amount (absolute) and currency, when it showed one */ rowAmount?: number; rowCurrency?: string; /** invoice amount / row amount, when the currencies differ: the rate the vendor and bank really applied */ fxRateImplied?: number } & Pick<Candidate, "matchedBy" | "amountVerified" | "offsetDays" | "score">)
  | { kind: "none" }
  | { kind: "many"; candidates: number[]; details: Candidate[] };

const AMOUNT_GAP = 0.3, FULL_UNTIL = 3, THRESHOLD = 0.5, W_DATE = 1, W_AMOUNT = 1.5, REF_BOOST = 0.6, GUESS = 0.6, UNCONFIRMED = 0.2; // a row showing no comparable amount stays a candidate but ranks below one that confirms it
const dateScore = (o: number, maxBefore: number, maxAfter: number) =>
  o >= 0 ? (o <= FULL_UNTIL ? 1 : o >= maxBefore ? 0 : 1 - (o - FULL_UNTIL) / (maxBefore - FULL_UNTIL)) : -o >= maxAfter ? 0 : 1 - -o / (maxAfter + 0.25);
const bandScore = (off: number, band: number) => (off <= band ? 1 : off >= 2 * band ? 0 : 1 - (off - band) / band);

const DATE_SHAPES = [/\d{4}-\d{2}-\d{2}/g, /\d{2}[./-]\d{2}[./-]\d{2,4}/g];
/** Whole alphanumeric tokens of a text, lowercased; a hyphenated token is kept whole and its halves are added. */
const tokens = (text: string): Set<string> => {
  let t = text.toLowerCase();
  for (const re of DATE_SHAPES) t = t.replace(re, " ");
  const out = new Set<string>();
  for (const w of t.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) (out.add(w), w.split("-").forEach((h) => out.add(h)));
  return out;
};
/** Reference candidates from the transaction text: 5+ characters with a digit, no account-number-length digit runs. Plain words and the merchant name carry no digit. */
const referenceTokens = (text: string | undefined): string[] => [...tokens(text ?? "")].filter((w) => w.length >= 5 && /\d/.test(w) && (w.match(/\d/g) ?? []).length < 12);

type Fit = { r: MatchRow; o: number; d: { y: number; m: number; d: number }; guess: boolean; due: boolean };
/** Row decision from the viable candidates, best first. "many" when anything but the date could not separate them. */
function decide(viable: Candidate[], margin: number, targetHasAmount: boolean): "one" | "many" {
  const [top, ...rest] = viable;
  if (!top) return "many";
  const exact = top.amount?.score === 1 && top.amount.rate === undefined;
  if (rest[0] && top.score - rest[0].score < margin) return "many";
  if (!top.reference && (top.due || (top.guess && !exact))) return "many";
  if (top.reference) return "one";
  // Without a reference, the date never separates rows that fit the amount about equally (any fit short of an exact same-currency one).
  if (!exact && rest.some((c) => (c.amount?.score ?? 0) >= 0.5 && (top.amount?.score ?? 0) - c.amount!.score < AMOUNT_GAP)) return "many";
  // A row with no amount only beats a rival that its amount contradicts outright, not one that merely scored low.
  if (targetHasAmount && !top.amount && rest.some((c) => (c.amount?.score ?? 0) > 0)) return "many";
  return "one";
}

/**
 * Scores every row with a date inside the window on date, amount and reference, and picks the one row, or says it cannot.
 * Date: see MatchOptions. Amount: within 0.01 in the same currency; in another currency a rate gives a band; a row showing no
 * comparable amount is neutral. A reference (a whole token of target.reference, such as an invoice number) found in the row boosts
 * it, but never over an amount that does not fit. A row showing several dates whose best date is not its earliest is a guess.
 * Wrong picks cost more than hand-offs: see `decide`. Rows showing only negative amounts are excluded.
 */
export function matchRows(
  rows: MatchRow[],
  target: { date: string; amount?: number; currency?: string; reference?: string },
  opts: MatchOptions = {},
): RowMatch {
  const [maxBefore, maxAfter, margin] = [opts.maxBefore ?? 7, opts.maxAfter ?? 2, opts.margin ?? 0.15];
  const [ty, tm, td] = isoParts(target.date.slice(0, 10));
  const t = dayNum(ty, tm, td);
  const order = listOrder(rows.map((r) => r.text));
  const table = { ...EUR_RATES, ...opts.rates };
  const callerRate = opts.rateFor !== undefined || opts.rates !== undefined;
  const rate = (from: string, to: string) => opts.rateFor?.(from, to) ?? fxRate(from, to, table);
  const refs = referenceTokens(target.reference);
  const inWindow: Fit[] = [];
  for (const r of rows) {
    const shown = parseAmounts(r.text, { strict: true });
    if (shown.length && shown.every((a) => a.value < 0)) continue;
    const dates = readings(r.text, order);
    const earliest = Math.min(...dates.map((d) => dayNum(d.y, d.m, d.d!)));
    const several = new Set(dates.map((d) => d.raw)).size > 1;
    let best: Fit | undefined, bestScore = 0;
    for (const d of dates) {
      const n = dayNum(d.y, d.m, d.d!), o = t - n;
      const due = several && n !== earliest, guess = !!d.amb || due;
      const s = dateScore(o, maxBefore, maxAfter) * (guess ? GUESS : 1);
      if (s > bestScore) (bestScore = s), (best = { r, o, d: { y: d.y, m: d.m, d: d.d! }, guess, due });
    }
    if (best) inWindow.push(best);
  }
  const base = opts.band ?? (callerRate ? 0.05 : 0.08);
  // The built-in table's band stays as given; a caller's rates are trusted more, so the band tightens with candidate density (floor 2 %).
  const band = callerRate ? Math.max(0.02, inWindow.length >= 2 ? base / 2 : base) : base;
  const cands: Candidate[] = inWindow.map(({ r, o, d, guess, due }) => {
    const ds = dateScore(o, maxBefore, maxAfter) * (guess ? GUESS : 1);
    let amount: Candidate["amount"];
    if (target.amount !== undefined) {
      for (const a of parseAmounts(r.text, { strict: true }).filter((x) => x.value >= 0)) {
        let c: NonNullable<Candidate["amount"]> | undefined;
        if (agrees(a.currency, target.currency)) c = { ...a, score: Math.abs(a.value - target.amount) <= 0.01 ? 1 : 0 };
        else {
          const k = rate(a.currency!, target.currency!);
          if (k !== undefined && target.amount > 0) c = { ...a, rate: k, converted: a.value * k, score: bandScore(Math.abs((a.value * k) / target.amount - 1), band) };
        }
        if (c && (!amount || c.score > amount.score)) amount = c;
      }
    }
    const rowTokens = refs.length ? tokens(r.text) : new Set<string>();
    const ref = refs.some((x) => rowTokens.has(x)) && (!amount || amount.score >= 0.5);
    const full = amount?.score === 1;
    const base = (W_DATE * ds + (amount ? W_AMOUNT * amount.score : 0)) / (W_DATE + (amount ? W_AMOUNT : 0));
    return {
      index: r.index, score: base + (ref ? REF_BOOST : 0) - (target.amount !== undefined && !amount ? UNCONFIRMED : 0), offsetDays: o, date: d, ...(amount ? { amount } : {}), ...(ref ? { reference: true as const } : {}), ...(guess ? { guess: true as const } : {}), ...(due ? { due: true as const } : {}),
      matchedBy: [...(ds === 1 ? ["date" as const] : []), ...(full ? [amount!.rate !== undefined ? "amount-fx" as const : "amount" as const] : []), ...(ref ? ["reference" as const] : [])],
      amountVerified: full,
    };
  });
  const viable = cands.filter((c) => c.score >= THRESHOLD && c.amount?.score !== 0).sort((a, b) => b.score - a.score);
  if (!viable.length) return { kind: "none" };
  const top = viable[0]!;
  if (decide(viable, margin, target.amount !== undefined) === "many") {
    return { kind: "many", candidates: viable.map((c) => c.index).sort((x, y) => x - y), details: viable };
  }
  return { kind: "one", index: top.index, matchedBy: top.matchedBy, amountVerified: top.amountVerified, offsetDays: top.offsetDays, score: top.score, ...(top.amount ? { rowAmount: Math.abs(top.amount.value), ...(top.amount.currency ? { rowCurrency: top.amount.currency } : {}) } : {}), ...(top.amount?.rate !== undefined && top.amount.score > 0 ? { fxRateUsed: top.amount.rate, ...(top.amount.value > 0 ? { fxRateImplied: target.amount! / top.amount.value } : {}) } : {}) };
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (v: number, c?: string) => `${v.toFixed(2).replace(".", ",")}${c ? ` ${c}` : ""}`;

/** One line of evidence for a hand-off: "row 3: 21 Oct 2026, 200,00 USD (date +1 day, amount via USD→SEK 10.1: 2021.55 vs 2020.00)". Quotes no row text. */
export function describeCandidate(c: Candidate, target: { amount?: number; currency?: string }): string {
  const a = c.amount;
  const via = a?.rate !== undefined ? `amount via ${a.currency}→${target.currency} ${Number(a.rate.toPrecision(3))}: ${a.converted!.toFixed(2)} vs ${target.amount!.toFixed(2)}` : a ? `amount ${a.score === 1 ? "equal" : "differs"}` : "";
  const ev = [`date ${signed(c.offsetDays)} day${Math.abs(c.offsetDays) === 1 ? "" : "s"}`, via, c.reference ? "reference found" : ""].filter(Boolean).join(", ");
  return `row ${c.index}: ${c.date.d} ${MONTHS[c.date.m - 1]} ${c.date.y}${a ? `, ${money(a.value, a.currency)}` : ""} (${ev})`;
}

/** True for a short label that is itself a date or month ("October 2026", "1 Oct - 31 Oct 2026"): what a month or period selector shows. */
export const isPeriodLabel = (s: string): boolean => s.length <= 40 && parseDates(s).length > 0;

/** Period labels the target falls in: a month label by its month, a label with two dates as a range. A numeric label still ambiguous is no match. */
export function matchPeriod(labels: MatchRow[], target: { date: string }): PeriodMatch {
  const [ty, tm, td] = isoParts(target.date);
  const t = dayNum(ty, tm, td);
  const order = listOrder(labels.map((l) => l.text));
  const hits = labels.filter((l) => {
    const ds = parseDates(l.text).filter((d) => !d.amb || (order && d.amb === order));
    if (!ds.length || parseDates(l.text).some((d) => d.amb && !order)) return false;
    if (ds.length === 1) return ds[0]!.y === ty && ds[0]!.m === tm;
    const lo = Math.min(...ds.map((d) => dayNum(d.y, d.m, d.d ?? 1))), hi = Math.max(...ds.map((d) => dayNum(d.y, d.m, d.d ?? dim(d.y, d.m))));
    return t >= lo && t <= hi;
  }).map((l) => l.index);
  return hits.length === 0 ? { kind: "none" } : hits.length === 1 ? { kind: "one", index: hits[0]! } : { kind: "many", candidates: hits };
}

/** How many distinct full dates (with a day) a text shows. */
export const fullDateCount = (text: string): number => new Set(parseDates(text).filter((d) => d.d).map((d) => d.raw)).size;

/**
 * The nearest level of a row chain (see pageRowChain) that shows exactly one distinct full date; "" when none does. The walk stops at
 * the first level with two or more dates: that level and everything above it is a list, not a row.
 */
export function rowTextOf(chain: readonly string[] | null | undefined): string {
  for (const t of chain ?? []) {
    const n = fullDateCount(t);
    if (n > 1) return "";
    if (n === 1) return t;
  }
  return "";
}
