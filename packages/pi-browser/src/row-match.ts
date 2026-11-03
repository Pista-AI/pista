// Pure matcher: picks the invoice-list row a job is looking for. Output carries indices only (rows may hold personal data).

export type CandidateDate = { y: number; m: number; d?: number; monthOnly?: boolean; raw: string };
export type RowMatch = { kind: "one"; index: number } | { kind: "none" } | { kind: "many"; candidates: number[] };
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
    return dedupe([...full(y, +m[2], +m[1]), ...full(y, +m[1], +m[2])]);
  });
  run(new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s*${mon}\\.?,?\\s*(\\d{4})(?!\\d)`, "g"), (m) => full(+m[3], map.get(m[2])!, +m[1]));
  run(new RegExp(`${mon}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?!\\d),?\\s*(\\d{4})(?!\\d)`, "g"), (m) => full(+m[3], map.get(m[1])!, +m[2]));
  run(new RegExp(`${mon}\\.?,?\\s*(\\d{4})(?!\\d)`, "g"), (m) => [{ y: +m[2], m: map.get(m[1])!, monthOnly: true }]);
  return out;
}

const CURRENCIES = new Set<string>((Intl as any).supportedValuesOf?.("currency") ?? ["EUR", "USD", "GBP", "SEK", "NOK", "DKK", "CHF"]);
const SYM: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
const NUM = String.raw`\d{1,3}(?:[   ]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CUR = String.raw`€|\$|£|\bkr\b|\b[A-Z]{3}\b`;
const AMOUNT_RE = new RegExp(`(?:(${CUR})\\s*)?(?<![\\d.,/-])(${NUM})(?![\\d/-]|[.,]\\d)(?:\\s*(${CUR}))?`, "g");

function toNumber(raw: string): number {
  const s = raw.replace(/[   ]/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  const last = Math.max(lastDot, lastComma);
  if (last < 0) return Number(s);
  const tail = s.slice(last + 1);
  const count = s.split(s[last]).length - 1;
  const decimal = (lastDot >= 0 && lastComma >= 0) || (count === 1 && tail.length <= 2);
  return decimal ? Number(s.slice(0, last).replace(/[.,]/g, "") + "." + tail) : Number(s.replace(/[.,]/g, ""));
}

export function parseAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const c = [m[1], m[3]].find((x) => x && (SYM[x] || CURRENCIES.has(x)));
    const value = toNumber(m[2]);
    if (Number.isFinite(value)) out.push(c ? { value, currency: SYM[c] ?? c } : { value });
  }
  return out;
}

const dayNum = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000);
const isoParts = (iso: string) => iso.split("-").map(Number) as [number, number, number];

export function matchRows(
  rows: MatchRow[],
  target: { date: string; amount?: number; currency?: string },
  opts: { toleranceDays?: number } = {},
): RowMatch {
  const tol = opts.toleranceDays ?? 3;
  const [ty, tm, td] = isoParts(target.date);
  const t = dayNum(ty, tm, td);
  const text = new Map(rows.map((r) => [r.index, r.text]));
  // A row showing amounts, none equal to the target, is excluded; rows with no amount stay candidates.
  const amountOk = (i: number) => {
    if (target.amount === undefined) return true;
    const amts = parseAmounts(text.get(i)!);
    if (!amts.length) return true;
    return amts.some((a) => Math.abs(a.value - target.amount!) <= 0.01 && (!a.currency || !target.currency || a.currency === target.currency.toUpperCase()));
  };
  const hits: { index: number; dist: number }[] = [];
  for (const r of rows) {
    const ds = parseDates(r.text).filter((d) => d.d !== undefined);
    if (!ds.length || !amountOk(r.index)) continue;
    const dist = Math.min(...ds.map((d) => Math.abs(dayNum(d.y, d.m, d.d!) - t)));
    if (dist <= tol) hits.push({ index: r.index, dist });
  }
  if (!hits.length) return { kind: "none" };
  const min = Math.min(...hits.map((h) => h.dist));
  const pool = hits.filter((h) => h.dist === min);
  return pool.length === 1 ? { kind: "one", index: pool[0].index } : { kind: "many", candidates: pool.map((p) => p.index) };
}

export function matchPeriod(labels: MatchRow[], target: { date: string }): RowMatch {
  const [ty, tm] = isoParts(target.date);
  const hits = labels.filter((l) => parseDates(l.text).some((d) => d.y === ty && d.m === tm)).map((l) => l.index);
  return hits.length === 0 ? { kind: "none" } : hits.length === 1 ? { kind: "one", index: hits[0] } : { kind: "many", candidates: hits };
}
