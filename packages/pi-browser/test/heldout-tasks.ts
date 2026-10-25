/**
 * HELD-OUT browsing tasks (SUITE_SET=heldout, see suite.ts).
 *
 * These tasks exist to measure whether the browsing agent generalizes to sites nobody tuned against. No tool, prompt, extension or model setting
 * may be tuned against them: do not read their transcripts to fix a failure, do not add site-specific handling, do not copy a task into the
 * development set. Adding a task here means it is never used for development again. If a task turns out to be broken (the site changed, the
 * answer moved), fix or delete the task; do not "teach" the agent the site.
 *
 * Every expected answer was read off the live site by hand when the task was added (2026-10-19). Sites are disjoint from the development set
 * (wikipedia, books.toscrape.com, the restaurant-menu site, google.com/flights, dac.dk, aak.com, the 127.0.0.1 fixtures). Goals are one concrete
 * multi-step objective each: no logins, no purchases, no cart, no personal data. Checks are lenient regexes over stable facts.
 */

export interface Task {
  name: string;
  /** Page to start on. */
  url: string;
  goal: string;
  /** What to read off the final page and say in the answer. */
  report?: string;
  /** Known values for form fields, given to the model in the prompt. */
  inputs?: Record<string, string>;
  /** `answer` is the model's final message, `url` the browser's final URL. */
  check: (answer: string, url: string) => boolean;
  /** No known right answer: shown as n/a instead of PASS or FAIL. */
  unchecked?: string;
}

const has = (a: string, ...patterns: RegExp[]) => patterns.every((p) => p.test(a));

export const HELDOUT_TASKS: Task[] = [
  // --- transport ---
  {
    name: "ho-tfl-contact",
    url: "https://tfl.gov.uk/",
    goal: "Find Transport for London's customer services telephone number through the site's help and contact section.",
    report: "the telephone number and the days and hours the contact centre is open",
    check: (a) => /0343[\s-]*222[\s-]*1234/.test(a),
  },
  {
    name: "ho-sl-bla-linjen",
    url: "https://sl.se/",
    goal: "Hitta SL:s artikel \"Blå linjen fyller 50 år\" (under Aktuellt) och läs den.",
    report: "vilken station som var slutstation när Blå linjen först öppnade, och vilket år det var",
    check: (a) => has(a, /hjulsta/i, /1975/),
  },
  {
    name: "ho-sj-familjerabatt",
    url: "https://www.sj.se/",
    goal: "Ta reda på vilken rabatt SJ ger barn som reser tillsammans med en vuxen (familjeerbjudandet).",
    report: "hur många barn och vilka åldrar som omfattas, och hur många procent rabatt de får på dagtåg",
    check: (a) => /\b85\b/.test(a),
  },
  // --- government / authorities ---
  {
    name: "ho-gov-boxing-day",
    url: "https://www.gov.uk/",
    goal: "Find the UK government's list of bank holidays and look up the substitute day for Boxing Day in 2026 in England and Wales.",
    report: "the date and the weekday of that substitute bank holiday",
    check: (a) => /\b28(st|nd|rd|th)?\s+(of\s+)?dec/i.test(a) || /dec\w*\s+28\b/i.test(a),
  },
  {
    name: "ho-gov-maternity-leave",
    url: "https://www.gov.uk/",
    goal: "Find how long Statutory Maternity Leave is in the UK.",
    report: "the total length of the leave and how it is split between ordinary and additional leave",
    check: (a) => has(a, /\b52\b/, /\b26\b/),
  },
  {
    name: "ho-eu-newest-member",
    url: "https://european-union.europa.eu/",
    goal: "On the official EU website, find the list of EU member countries and work out which country joined most recently.",
    report: "the country's name and the year it joined",
    check: (a) => has(a, /croatia|kroatien|hrvatska/i, /2013/),
  },
  {
    name: "ho-polisen-114-14",
    url: "https://polisen.se/",
    goal: "Ta reda på vilket telefonnummer man ringer för att komma i kontakt med polisen när det inte är en nödsituation.",
    report: "numret, och vilket nummer som gäller vid pågående brott",
    check: (a) => /114[\s-]*14/.test(a),
  },
  {
    name: "ho-riksdagen-ledamoter",
    url: "https://www.riksdagen.se/sv/",
    goal: "Gå till riksdagens sida om ledamöter och partier och ta reda på hur många ledamöter Sveriges riksdag har.",
    report: "antalet ledamöter",
    check: (a) => /\b349\b/.test(a),
  },
  {
    name: "ho-transportstyrelsen-handledare",
    url: "https://www.transportstyrelsen.se/",
    goal: "Ta reda på vilka krav Transportstyrelsen ställer för att man ska bli godkänd som handledare vid övningskörning.",
    report: "lägsta ålder för handledaren och hur länge handledaren måste ha haft körkort",
    check: (a) => has(a, /\b24\b/, /\b(5|fem)\b/i),
  },
  {
    name: "ho-forsakringskassan-foraldrapenning",
    url: "https://www.forsakringskassan.se/",
    goal: "Ta reda på hur många dagar med föräldrapenning föräldrar får per barn att dela på.",
    report: "antalet dagar per barn",
    check: (a) => /\b480\b/.test(a),
  },
  {
    name: "ho-goteborg-kontaktcenter",
    url: "https://goteborg.se/",
    goal: "Hitta telefonnumret till Göteborgs Stads kontaktcenter.",
    report: "telefonnumret",
    check: (a) => /031[\s-]*365[\s-]*00[\s-]*00/.test(a),
  },
  // --- shop (product facts, no cart) ---
  {
    name: "ho-ikea-billy",
    url: "https://www.ikea.com/se/sv/",
    goal: "Hitta bokhyllan BILLY i vitt, 80x28x202 cm, på IKEA Sveriges webbplats och öppna produktsidan. Lägg ingenting i varukorgen.",
    report: "produktens artikelnummer",
    check: (a, url) => /002[.\s-]?638[.\s-]?50/.test(a) || /00263850/.test(url),
  },
  {
    name: "ho-ikea-kallax",
    url: "https://www.ikea.com/gb/en/",
    goal: "Find the KALLAX cube storage unit in white, 77x147 cm, on IKEA UK and open its product page. Do not add anything to the basket.",
    report: "the product's article number",
    check: (a, url) => /802[.\s-]?758[.\s-]?87/.test(a) || /80275887/.test(url),
  },
  // --- library / culture ---
  {
    name: "ho-gutenberg-pride",
    url: "https://www.gutenberg.org/",
    goal: "Search Project Gutenberg for Jane Austen's novel Pride and Prejudice and open its ebook page.",
    report: "the ebook number (the number in the page address)",
    check: (a, url) => /\b1342\b/.test(a) || /\/ebooks\/1342\b/.test(url),
  },
  {
    name: "ho-openlibrary-hobbit",
    url: "https://openlibrary.org/",
    goal: "On Open Library, search for The Hobbit by J.R.R. Tolkien and find the year the book was first published.",
    report: "the year of first publication",
    check: (a) => /\b1937\b/.test(a),
  },
  {
    name: "ho-loc-history",
    url: "https://www.loc.gov/",
    goal: "On the Library of Congress website, find the history of the Library.",
    report: "the year the British burned the Capitol (which destroyed the original library), and the year the Library's main building (now the Thomas Jefferson Building) opened",
    check: (a) => has(a, /\b1814\b/, /\b1897\b/),
  },
  {
    name: "ho-nobel-literature-2016",
    url: "https://www.nobelprize.org/",
    goal: "Find the Nobel Prize in Literature 2016.",
    report: "the laureate and the prize motivation",
    check: (a) => /dylan/i.test(a),
  },
  // --- travel ---
  {
    name: "ho-vasa-adress",
    url: "https://www.vasamuseet.se/sv",
    goal: "Hitta Vasamuseets besöksadress i Stockholm.",
    report: "gatuadressen",
    check: (a) => /gal[äa]rvarvsv[äa]gen\s*14/i.test(a),
  },
  {
    name: "ho-arlanda-invigning",
    url: "https://www.swedavia.se/arlanda/",
    goal: "Öppna sidan Om flygplatsen för Stockholm Arlanda Airport och läs faktarutan.",
    report: "invigningsåret som anges i faktarutan",
    check: (a) => /\b1962\b/.test(a),
  },
  // --- restaurant ---
  {
    name: "ho-pelikan-historia",
    url: "https://www.pelikan.se/",
    goal: "Läs om restaurang Pelikans historia på restaurangens webbplats.",
    report: "vilket år krogen öppnades i huset på Blekingegatan 40",
    check: (a) => /\b1904\b/.test(a),
  },
  {
    name: "ho-sturehof-phone",
    url: "https://sturehof.com/",
    goal: "Find the telephone number of the Sturehof restaurant in Stockholm (the restaurant itself, not the food market).",
    report: "the telephone number",
    check: (a) => /440[\s-]*57[\s-]*30/.test(a),
  },
];
