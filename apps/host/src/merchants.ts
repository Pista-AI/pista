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

/** One untrusted keyword made safe: upper case, Unicode letters, digits and `&.' -` only, 4-40 chars, no one-letter or opaque words, a letter run of 3+, not only generic words. */
export function cleanMerchant(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.slice(0, 200).normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}&.' -]/gu, "").replace(/\s+/g, " ").trim();
  if (s.length < 4 || s.length > 40 || !/\p{L}{3}/u.test(s)) return undefined;
  const words = s.split(" ");
  if (words.some((w) => w.length < 2 || (w.length >= 20 && /\d/.test(w) && /\p{L}/u.test(w))) || words.every(isStopword)) return undefined;
  return s;
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
