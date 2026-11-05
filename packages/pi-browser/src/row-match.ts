// Pure matcher: picks the invoice-list row a job is looking for. Output carries indices only (rows may hold personal data).

/** `amb` marks one reading of a numeric date that could be day-first or month-first; both readings are emitted. */
export type CandidateDate = { y: number; m: number; d?: number; monthOnly?: boolean; amb?: "dmy" | "mdy"; raw: string };
export type RowMatch = { kind: "one"; index: number; /** false: matched by date alone because the row shows only another currency */ amountVerified?: false } | { kind: "none" } | { kind: "many"; candidates: number[] };
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

/** Whether the text shows an amount equal to `amount` (a row without one is not evidence about it). */
export const amountShown = (text: string, amount: number, currency?: string): boolean => parseAmounts(text, { strict: true }).some((a) => Math.abs(a.value - amount) <= 0.01 && agrees(a.currency, currency));

/**
 * Whether an invoice amount can be compared with the amounts in `text`: false only when the text shows amounts and every one carries a
 * currency that is not the invoice's (a USD line against a SEK bank charge). A text without amounts, or with one that is in the
 * invoice's currency or has no currency, is comparable.
 */
export const amountComparable = (text: string, currency?: string): boolean => {
  const shown = parseAmounts(text, { strict: true });
  return !shown.length || shown.some((a) => agrees(a.currency, currency));
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
 * Picks the one row for the invoice, or says it cannot. Every row with a date within the tolerance counts (the closest date does not
 * win), so two rows, or two dates in one row near the target, give "many". A row matching only through a day-first/month-first guess
 * counts only with an exactly matching amount; otherwise the answer is "many". Rows showing amounts that do not match are excluded;
 * rows showing none stay candidates only when no row has an equal amount.
 */
export function matchRows(
  rows: MatchRow[],
  target: { date: string; amount?: number; currency?: string },
  opts: { toleranceDays?: number } = {},
): RowMatch {
  const tol = opts.toleranceDays ?? 3;
  const [ty, tm, td] = isoParts(target.date);
  const t = dayNum(ty, tm, td);
  const order = listOrder(rows.map((r) => r.text));
  let hits: { index: number; sure: boolean; amounts: Amount[]; foreign: boolean }[] = [];
  for (const r of rows) {
    const near = readings(r.text, order).filter((d) => Math.abs(dayNum(d.y, d.m, d.d!) - t) <= tol);
    if (near.length) hits.push({ index: r.index, sure: near.some((d) => !d.amb), amounts: parseAmounts(r.text, { strict: true }), foreign: target.amount !== undefined && !amountComparable(r.text, target.currency) });
  }
  const equal = (h: { amounts: Amount[] }) => target.amount !== undefined && h.amounts.some((a) => Math.abs(a.value - target.amount!) <= 0.01 && agrees(a.currency, target.currency));
  if (target.amount !== undefined) {
    if (hits.some(equal)) hits = hits.filter(equal);
    else hits = hits.filter((h) => !h.amounts.length || h.foreign); // a row in another currency is judged by its date alone
  }
  if (!hits.length) return { kind: "none" };
  const doubtful = hits.some((h) => !h.sure && !equal(h));
  return hits.length === 1 && !doubtful ? { kind: "one", index: hits[0]!.index, ...(hits[0]!.foreign && !equal(hits[0]!) ? { amountVerified: false as const } : {}) } : { kind: "many", candidates: hits.map((h) => h.index) };
}

/** True for a short label that is itself a date or month ("October 2026", "1 Oct - 31 Oct 2026"): what a month or period selector shows. */
export const isPeriodLabel = (s: string): boolean => s.length <= 40 && parseDates(s).length > 0;

/** Period labels the target falls in: a month label by its month, a label with two dates as a range. A numeric label still ambiguous is no match. */
export function matchPeriod(labels: MatchRow[], target: { date: string }): RowMatch {
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
