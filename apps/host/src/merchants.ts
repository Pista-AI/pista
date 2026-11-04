// Merchant keywords: how a bank or card transaction's text is reduced to a keyword that identifies a vendor. Untrusted input throughout.

export const MAX_MERCHANTS = 5;
/** Longest list and longest item `setMerchants` looks at before cleaning. */
export const MAX_MERCHANT_INPUT = 10;
export const MAX_MERCHANT_INPUT_CHARS = 80;

/** Words that are company forms, payment processors, payment terms, bank-statement words or generic business words, not a vendor name. Diacritics are folded (KÖP is KOP). */
export const MERCHANT_STOPWORDS: ReadonlySet<string> = new Set([
  // company forms and web boilerplate
  "LLC", "INC", "LTD", "LIMITED", "AB", "GMBH", "CORP", "CORPORATION", "CO", "COM", "WWW", "HTTP", "HTTPS", "PLC", "LLP", "AG", "SA", "AS", "OY", "BV", "NV", "KB", "HB", "APS", "SRL", "SARL", "PTY", "THE", "AND", "OF", "TO", "FROM",
  // processors and payment terms
  "PAYPAL", "SQ", "SQUARE", "STRIPE", "KLARNA", "ZETTLE", "SUMUP", "CARD", "PAYMENT", "PAYMENTS", "INVOICE", "SUBSCRIPTION", "VISA", "MASTERCARD",
  // bank-statement words
  "KORTKOP", "KORT", "KOP", "BETALNING", "SWISH", "AUTOGIRO", "OVERFORING", "INSATTNING", "UTTAG", "PURCHASE", "POS", "DEBIT", "CREDIT", "BG", "PG", "KARTENZAHLUNG", "KARTENKAUF", "LASTSCHRIFT",
  // generic business words
  "CLOUD", "HOSTING", "SHOP", "STORE", "APP", "APPS", "ONLINE", "SERVICES", "SERVICE", "DIGITAL", "TECH", "SOFTWARE", "MEDIA", "GROUP", "NORDIC", "SVERIGE", "SWEDEN", "EUROPE", "INTERNATIONAL",
]);

/** Letters without their accents, for comparing against the (accent-free) stopword and place lists. */
const fold = (w: string): string => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const isStopword = (w: string): boolean => MERCHANT_STOPWORDS.has(fold(w));
/** Words that mark a transfer to or from a person, never a vendor. */
const PERSON_LINE = new Set(["SWISH", "OVERFORING", "TILL", "AUTOGIRO", "BANKGIRO", "PLUSGIRO"]);
const PERSON_PHRASE = /\b(?:TRANSFER|PAYMENT|BETALNING) TO\b/;
/** "Firstname Lastname" and nothing else: two capitalised words. */
const PERSON_NAME = /^\p{Lu}\p{Ll}+(?:[-']\p{Lu}\p{Ll}+)?\s+\p{Lu}\p{Ll}+(?:[-']\p{Lu}\p{Ll}+)?$/u;
/** Processor prefixes in front of the merchant: "SQ *", "TST*", "PAYPAL *", "GOOGLE *", "KLARNA *", "ZETTLE_". */
export const PROCESSOR_PREFIX = /^\s*(?:SQ|TST|PAYPAL|PP|GOOGLE|STRIPE|SP|IZ|PAYU|ZETTLE|KLARNA|SUMUP|AMZN MKTP)\s*[*_]\s*/;
/** Trailing places that follow a merchant name. */
const PLACES = new Set(["STOCKHOLM", "GOTEBORG", "GOTHENBURG", "MALMO", "UPPSALA", "SAN", "NEW", "LOS", "LAS", "LONDON", "DUBLIN", "AMSTERDAM", "BERLIN", "PARIS", "HELSINKI", "OSLO", "COPENHAGEN", "KOBENHAVN", "LUXEMBOURG", "SEATTLE", "MOUNTAIN", "CAMBRIDGE", "SINGAPORE", "IRELAND", "USA", "GBR", "SWE", "IRL", "NLD", "DEU", "FRA"]);

/** Upper case, NFKC (letters such as Å, Ø, É stay), processor prefix and everything from the first `*` reference on removed. */
export function normaliseMerchant(text: string): string {
  const s = text.slice(0, 200).normalize("NFKC").toUpperCase().replace(PROCESSOR_PREFIX, "");
  return s.split("*").map((p) => p.trim()).find(Boolean) ?? "";
}

/** Most `*` wildcards in one keyword, and fewest literal letters it must keep. */
export const MAX_WILDCARDS = 2;
export const MIN_LITERAL_LETTERS = 3;

/**
 * One untrusted keyword made safe: upper case, Unicode letters, digits and `&.' -` only, 4-40 chars, no one-letter or opaque words, a letter run of 3+, not only generic words.
 * With `wildcards` (keywords the user typed, never the model's) `*` is kept: an inner `*` only, at most 2, and 3+ literal letters in all.
 */
export function cleanMerchant(v: unknown, wildcards = false): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.slice(0, 200).normalize("NFKC").toUpperCase().replace(wildcards ? /[^\p{L}\p{N}&.' *-]/gu : /[^\p{L}\p{N}&.' -]/gu, "").replace(/\s+/g, " ").trim();
  const stars = s.split("*").length - 1;
  if (s.length < 4 || s.length > 40 || stars > MAX_WILDCARDS || s.startsWith("*") || s.endsWith("*")) return undefined;
  if (stars ? literalLetters(s) < MIN_LITERAL_LETTERS : !/\p{L}{3}/u.test(s)) return undefined;
  // a wildcard keyword needs one distinctive segment: 3+ literal letters that are not only generic or umbrella words
  if (stars && s.split("*").some((seg) => !seg.trim())) return undefined;
  if (stars && !s.split("*").some((seg) => literalLetters(seg) >= MIN_LITERAL_LETTERS && !seg.trim().split(" ").every((w) => isStopword(w) || UMBRELLA_BRANDS.has(fold(w))))) return undefined;
  const words = s.split(" ");
  if (words.some((w) => w.length < 2 || (w.length >= 20 && /\d/.test(w) && /\p{L}/u.test(w))) || words.every(isStopword)) return undefined;
  return s;
}

/** Letters a keyword spells out (wildcards and punctuation not counted). */
export const literalLetters = (keyword: string): number => (keyword.match(/\p{L}/gu) ?? []).length;

/** A transaction's text for matching: upper case, processor prefix removed, every `*` a space (so `ADOBE*CREATIVE` is `ADOBE CREATIVE`). */
export function matchText(text: string): string {
  return text.slice(0, 200).normalize("NFKC").toUpperCase().replace(PROCESSOR_PREFIX, "").replace(/\*/g, " ").replace(/\s+/g, " ").trim();
}

/** Of the keywords that match, the most specific one (most literal letters), or undefined. */
export function mostSpecificKeyword(keywords: readonly string[], merchantText: string): string | undefined {
  return keywords.filter((k) => keywordMatches(k, merchantText)).sort((a, b) => literalLetters(b) - literalLetters(a))[0];
}

/**
 * Whether a keyword is in a merchant's text: whole words at both ends (Unicode letters and digits), and each `*` matches any run of characters.
 * Plain scanning with `indexOf`, no regular expression, so no input can make it slow (the text is cut to 200 characters).
 */
export function keywordMatches(keyword: string, merchantText: string): boolean {
  const text = matchText(merchantText);
  const kw = keyword.includes("*") ? keyword : matchText(keyword);
  if (!kw || !text) return false;
  const parts = kw.split("*");
  const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  const first = parts[0]!, last = parts[parts.length - 1]!;
  if (!first || !last) return false;
  for (let at = text.indexOf(first); at !== -1; at = text.indexOf(first, at + 1)) {
    if (isWord(text[at - 1])) continue;
    let pos = at + first.length;
    let ok = true;
    for (const mid of parts.slice(1, -1)) {
      const i = mid ? text.indexOf(mid, pos) : pos;
      if (i === -1) { ok = false; break; }
      pos = i + mid.length;
    }
    if (!ok) continue;
    if (parts.length === 1) { if (!isWord(text[pos])) return true; continue; }
    for (let e = text.indexOf(last, pos); e !== -1; e = text.indexOf(last, e + 1)) if (!isWord(text[e + last.length])) return true;
  }
  return false;
}

/** The user's keyword list: wildcards allowed. */
export function cleanUserMerchants(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.flatMap((m) => cleanMerchant(m, true) ?? []))].slice(0, MAX_MERCHANTS);
}

/** Cleaned, de-duplicated keywords, at most 5; the earliest win. */
export function cleanMerchants(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.flatMap((m) => cleanMerchant(m) ?? []))].slice(0, MAX_MERCHANTS);
}

/**
 * One keyword from a transaction's merchant text, or undefined: drops processor prefixes, `*1234` references, dates, amounts, ids,
 * bank-statement and company words and trailing places, then keeps the first one or two words. "ACME ROBOTICS LLC*1234 SAN FRANCISCO"
 * gives "ACME ROBOTICS". Swish and transfer lines give nothing.
 */
export function merchantKeyword(text: string): string | undefined {
  if (PERSON_NAME.test(text.trim())) return undefined;
  const head = normaliseMerchant(text);
  const tokens = head.split(/\s+/);
  if (tokens.some((t) => PERSON_LINE.has(fold(t))) || PERSON_PHRASE.test(fold(head))) return undefined;
  const words: string[] = [];
  for (const raw of tokens) {
    const w = raw.replace(/[^\p{L}\p{N}&.'-]/gu, "").replace(/^[.'-]+|[.'-]+$/g, "");
    if (!w) continue;
    if (!words.length) {
      if (/^[\d.,'-]+$/.test(w) || isStopword(w)) continue;
    } else if (/^\d/.test(w) || w.length < 2 || isStopword(w) || PLACES.has(fold(w))) break;
    words.push(w);
    if (words.length === 2) break;
  }
  return cleanMerchant(words.join(" "));
}

/** Names of umbrella brands and payment processors that stand for many unrelated charges. Data, not a list of supported vendors. */
export const UMBRELLA_BRANDS: ReadonlySet<string> = new Set(["GOOGLE", "APPLE", "AMAZON", "AMZN", "MICROSOFT", "META", "PAYPAL", "STRIPE", "KLARNA", "ADYEN", "SQUARE", "SHOPIFY"]);

export type BroadReason = "short" | "umbrella" | "other-site" | "unsure" | "unverified-elsewhere";
export const BROAD_REASONS: ReadonlySet<string> = new Set<BroadReason>(["short", "umbrella", "other-site", "unsure", "unverified-elsewhere"]);

export interface BroadContext {
  /** The model said it was unsure the keyword is specific. */
  unsure?: boolean;
  /** Keywords already confirmed or pending on other sites. */
  otherSites?: readonly string[];
  /** Hook for a later rule: the keyword matched other lines in the same paste that did not verify on this site. */
  unverifiedElsewhere?: boolean;
}

/** Why a keyword is too broad to confirm without the user, or undefined. Deterministic checks the model cannot waive. */
export function broadReason(keyword: string, ctx: BroadContext = {}): BroadReason | undefined {
  if (literalLetters(keyword) < 4) return "short";
  if (keyword.split(/[\s*]+/).some((w) => UMBRELLA_BRANDS.has(fold(w)))) return "umbrella";
  if (ctx.otherSites?.includes(keyword)) return "other-site";
  if (ctx.unsure) return "unsure";
  if (ctx.unverifiedElsewhere) return "unverified-elsewhere";
  return undefined;
}
