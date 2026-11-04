import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ReplayStep } from "@pista/pi-browser";
import type { Playbook, PlaybookStep } from "@pista/protocol";
import { MERCHANT_STOPWORDS, merchantKeyword, normaliseMerchant } from "./merchants.ts";
import { FAIL_THRESHOLD, deletePlaybook, getPlaybook, listPlaybooks, recordFailure, recordSuccess, sanitizeUrl, savePlaybook, siteKey, validatePlaybook } from "./playbooks.ts";

// Stored steps must stay replayable: the runner in pi-browser types them structurally (checked by pnpm typecheck).
export const replayable: (steps: Playbook["steps"]) => ReplayStep[] = (steps) => steps;

const base = (extra: Record<string, unknown> = {}) => ({ startUrl: "https://app.example.com/login", steps: [{ kind: "navigate", url: "https://example.com/invoices" }], ...extra });

describe("siteKey", () => {
  it("collapses subdomains and handles multi-part suffixes and IPs", () => {
    assert.equal(siteKey("https://a.b.Example.com/x"), "example.com");
    assert.equal(siteKey("https://shop.example.co.uk"), "example.co.uk");
    assert.equal(siteKey("http://127.0.0.1:8080/p"), "127.0.0.1");
    assert.equal(siteKey("http://localhost:3000"), "localhost");
    assert.notEqual(siteKey("https://a.github.io"), siteKey("https://b.github.io"));
  });
  it("rejects non-http(s)", () => {
    assert.throws(() => siteKey("file:///etc/passwd"));
    assert.throws(() => siteKey("javascript:alert(1)"));
    assert.throws(() => siteKey("data:text/html,hi"));
  });
});

describe("sanitizeUrl", () => {
  it("rejects cross-site and userinfo", () => {
    assert.throws(() => sanitizeUrl("https://evil.com/", "example.com"));
    assert.throws(() => sanitizeUrl("https://u:p@example.com/", "example.com"));
  });
  it("keeps readable slugs, rejects hex and JWT-like segments", () => {
    assert.doesNotThrow(() => sanitizeUrl("https://example.com/invoices-and-payment-history-overview", "example.com"));
    assert.throws(() => sanitizeUrl(`https://example.com/x/${"0123abcd".repeat(8)}`, "example.com"));
    assert.throws(() => sanitizeUrl("https://example.com/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r", "example.com"));
  });
  it("rejects opaque path segments", () => {
    assert.throws(() => sanitizeUrl(`https://example.com/reset/${"ab12".repeat(16)}`, "example.com"));
  });
  it("matches secret keys as whole words only", () => {
    const out = new URL(sanitizeUrl("https://example.com/p?monkey=1&passenger=2&accessible=3&access_token=a&X-Auth=b&TOKEN=c", "example.com"));
    assert.deepEqual([...out.searchParams.keys()], ["monkey", "passenger", "accessible"]);
  });
  it("strips secrets, opaque values and fragments, keeps benign params", () => {
    const out = new URL(sanitizeUrl(`https://x.example.com/p?token=1&Code=2&utm_source=a&page=2&blob=${"a1".repeat(20)}#frag`, "example.com"));
    assert.equal(out.hash, "");
    assert.deepEqual([...out.searchParams.keys()], ["page"]);
  });
});

describe("validatePlaybook", () => {
  it("drops unknown fields and truncates long text", () => {
    const pb = validatePlaybook(base({ evil: 1, steps: [{ kind: "click", target: { name: "x".repeat(500), bogus: 1 }, extra: 1 }] }), "example.com");
    assert.equal("evil" in pb, false);
    const s = pb.steps[0] as { target: { name: string } };
    assert.equal(s.target.name.length, 200);
    assert.equal("bogus" in s.target, false);
  });
  it("enforces limits and rejects unknown kinds and foreign origins", () => {
    const nav = { kind: "navigate", url: "https://example.com/" };
    assert.throws(() => validatePlaybook(base({ steps: Array(31).fill(nav) }), "example.com"));
    assert.throws(() => validatePlaybook(base({ steps: [{ kind: "click", target: {}, fallbacks: Array(6).fill({}) }] }), "example.com"));
    assert.throws(() => validatePlaybook(base({ steps: [{ kind: "eval", code: "1" }] }), "example.com"));
    assert.throws(() => validatePlaybook(base({ steps: [{ kind: "signIn", origin: "https://evil.com" }] }), "example.com"));
  });
});

describe("validatePlaybook details", () => {
  it("rejects cross-site frameUrl and download url, drops opaque expectations, trims signIn dot", () => {
    assert.throws(() => validatePlaybook(base({ steps: [{ kind: "click", target: { frameUrl: "https://evil.com/" } }] }), "example.com"));
    assert.throws(() => validatePlaybook(base({ steps: [{ kind: "download", url: "https://evil.com/a.pdf" }] }), "example.com"));
    const pb = validatePlaybook(base({ steps: [
      { kind: "wait", expect: { urlIncludes: "a1".repeat(20), text: "b2".repeat(20) } },
      { kind: "signIn", origin: "https://app.example.com./x" },
    ] }), "example.com");
    assert.equal(pb.steps.length, 1); // the emptied wait is dropped
    assert.equal((pb.steps[0] as { origin: string }).origin, "https://app.example.com");
  });
});

describe("store", () => {
  const prev = process.env.PISTA_HOME;
  beforeEach(() => { process.env.PISTA_HOME = mkdtempSync(join(tmpdir(), "pista-pb-")); });
  afterEach(() => { if (prev === undefined) delete process.env.PISTA_HOME; else process.env.PISTA_HOME = prev; });

  const make = (): Playbook => validatePlaybook(base(), "example.com");

  it("round-trips save, list, get, delete", () => {
    savePlaybook(make());
    assert.equal(listPlaybooks().length, 1);
    assert.equal(listPlaybooks()[0].stepCount, 1);
    assert.equal(getPlaybook("example.com")?.startUrl, "https://app.example.com/login");
    assert.deepEqual(readdirSync(join(process.env.PISTA_HOME!, "playbooks")), ["example.com.json"]);
    deletePlaybook("example.com");
    assert.equal(getPlaybook("example.com"), null);
    assert.deepEqual(listPlaybooks(), []);
  });
  it("skips corrupt files and files whose site differs from the filename", () => {
    savePlaybook(make());
    const d = join(process.env.PISTA_HOME!, "playbooks");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "broken.com.json"), "{nope");
    writeFileSync(join(d, "other.com.json"), JSON.stringify({ ...make(), site: "example.com" }));
    assert.deepEqual(listPlaybooks().map((m) => m.site), ["example.com"]);
    assert.equal(getPlaybook("other.com"), null);
  });
  it("rejects unsafe site names", () => {
    assert.throws(() => getPlaybook("../x"));
    assert.throws(() => deletePlaybook("a/b"));
  });
  it("flags needs-attention after repeated failures and resets on success", () => {
    savePlaybook(make());
    for (let i = 1; i < FAIL_THRESHOLD; i++) assert.equal(recordFailure("example.com")?.status, "ok");
    assert.equal(recordFailure("example.com")?.status, "needs-attention");
    const ok = recordSuccess("example.com");
    assert.equal(ok?.status, "ok");
    assert.equal(ok?.failCount, 0);
    assert.equal(ok?.successCount, 1);
    assert.ok(ok?.lastSucceeded);
  });
});

describe("locator row", () => {
  const withRow = (row: unknown) => validatePlaybook(base({ steps: [{ kind: "click", target: { role: "link", name: "Download", row } }] }), "example.com").steps[0] as Extract<PlaybookStep, { kind: "click" }>;
  it("keeps date and amount once, drops unknown values, and needs date", () => {
    assert.deepEqual(withRow({ match: ["date", "amount", "date", "text", 3] }).target.row, { match: ["amount", "date"] });
    assert.deepEqual(withRow({ match: ["date"] }).target.row, { match: ["date"] });
    assert.equal(withRow({ match: ["amount"] }).target.row, undefined);
    assert.equal(withRow({ match: "date" }).target.row, undefined);
    assert.equal(withRow("date").target.row, undefined);
  });
});

it("expect.element locators lose row and period", async () => {
  const { validatePlaybook } = await import("./playbooks.ts");
  const pb = validatePlaybook({ startUrl: "https://x.test/", steps: [{ kind: "click", target: { role: "link", name: "A" }, expect: { element: { role: "link", name: "B", row: { match: ["date"] }, period: true } } }, { kind: "download", url: "https://x.test/a.pdf" }] }, "x.test");
  assert.deepEqual((pb.steps[0] as { expect: { element: object } }).expect.element, { role: "link", name: "B" });
});

describe("shortcut", () => {
  const steps = [
    { kind: "click", target: { role: "button", name: "Menu" } },
    { kind: "click", target: { role: "tab", name: "Invoices" }, expect: { text: "Invoices" } },
    { kind: "click", target: { role: "link", name: "Download", row: { match: ["date"] } } },
    { kind: "download", fileType: "pdf" },
  ];
  const pb = (shortcut: unknown, over: unknown[] = steps) => validatePlaybook({ startUrl: "https://example.com/", steps: over, shortcut }, "example.com");
  const ok = { url: "https://example.com/account/invoices", afterStep: 2 };
  it("keeps a same-site address with the volatile query stripped, after a step that expects something", () => {
    assert.deepEqual(pb({ ...ok, url: `${ok.url}?utm_source=x#top` }).shortcut, ok);
  });
  it("drops it for another site, an opaque path, or a step out of range, on or after an invoice-dependent step", () => {
    for (const bad of [
      { ...ok, url: "https://evil.test/invoices" },
      { ...ok, url: `https://example.com/x/${"0123abcd".repeat(8)}` },
      { ...ok, afterStep: 0 },
      { ...ok, afterStep: 1.5 },
      { ...ok, afterStep: 5 },
      { ...ok, afterStep: 3 },
      { ...ok, afterStep: 4 },
      { ...ok, afterStep: 1 }, // no expectation to recognise the page by
      { ...ok, url: 5 },
      ok.url,
    ]) assert.equal(pb(bad).shortcut, undefined, JSON.stringify(bad));
  });
  it("drops it when a skipped step signs in or looks like an account, workspace or organisation chooser", () => {
    const exp = { expect: { urlIncludes: "/invoices" } };
    for (const first of [{ kind: "signIn", origin: "https://example.com" }, { kind: "click", target: { role: "menuitem", name: "Acme" } }, { kind: "click", target: { role: "button", name: "Switch workspace" } }, { kind: "click", target: { role: "link", text: "Company profile" } }, { kind: "click", target: { role: "button", name: "Go" }, fallbacks: [{ role: "radio", name: "A" }] }]) {
      assert.equal(pb(ok, [first, { kind: "click", target: { role: "tab", name: "Invoices" }, ...exp }, steps[3]]).shortcut, undefined, JSON.stringify(first));
    }
    const menu = [{ kind: "click", target: { role: "button", name: "Account menu" } }, { kind: "click", target: { role: "tab", name: "Invoices" }, ...exp }, steps[3]];
    assert.deepEqual(pb(ok, menu).shortcut, ok, "a button that only opens a menu is fine");
    assert.equal(pb(ok, [{ kind: "click", target: { role: "menuitem", name: "Acme Corp" } }, menu[1], steps[3]]).shortcut, undefined);
    assert.equal(pb(ok, [{ kind: "click", target: { role: "button", name: "Switch account" } }, menu[1], steps[3]]).shortcut, undefined);
    assert.deepEqual(pb(ok, [{ kind: "click", target: { role: "button", name: "Menu" } }, { kind: "click", target: { role: "tab", name: "Invoices" }, ...exp }, steps[3]]).shortcut, ok);
  });
  it("a candidate is validated the same way, and a shortcut wins over it", () => {
    assert.deepEqual(validatePlaybook({ startUrl: "https://example.com/", steps, shortcutCandidate: ok }, "example.com").shortcutCandidate, ok);
    assert.equal(validatePlaybook({ startUrl: "https://example.com/", steps, shortcutCandidate: { ...ok, afterStep: 3 } }, "example.com").shortcutCandidate, undefined);
    const both = validatePlaybook({ startUrl: "https://example.com/", steps, shortcut: ok, shortcutCandidate: ok }, "example.com");
    assert.deepEqual([both.shortcut, both.shortcutCandidate], [ok, undefined]);
  });
});

describe("validatePlaybook merchants", () => {
  const pb = (m: unknown, pending?: unknown) => validatePlaybook(base({ merchants: m, merchantsPending: pending }), "example.com");
  const merchants = (m: unknown) => pb(m).merchants;
  it("upper-cases, strips other characters, collapses spaces and dedupes", () => {
    assert.deepEqual(merchants(["acme  robotics", "ACME ROBOTICS", " Åhléns ", "a<b>c;d", "O'Reilly Media"]), ["ACME ROBOTICS", "ÅHLÉNS", "ABCD", "O'REILLY MEDIA"]);
  });
  it("keeps letters outside A-Z", () => {
    assert.deepEqual(merchants(["Ørsted", "Æble Café", "Straße Bräu", "Öberg Verkstad"]), ["ØRSTED", "ÆBLE CAFÉ", "STRASSE BRÄU", "ÖBERG VERKSTAD"]);
    assert.equal(merchantKeyword("Ørsted A/S Fredericia"), "ØRSTED");
    assert.equal(merchantKeyword("KORTKÖP Åhléns City"), "ÅHLÉNS CITY");
    assert.equal(merchantKeyword("Köp Café Göteborg Ö"), "CAFÉ");
  });
  it("enforces length, letters, one-letter tokens, opaque and generic words", () => {
    assert.equal(merchants(["ABC", "x".repeat(41), "1234567", "AB1 2CD", "A B C D", "0123abcd".repeat(5), "LLC", "PayPal", "Card Payment", "Cloud Hosting", "Kortköp", ...MERCHANT_STOPWORDS]), undefined);
    assert.deepEqual(merchants(["PAYPAL SPOTIFY", "Acme Cloud"]), ["PAYPAL SPOTIFY", "ACME CLOUD"]);
  });
  it("keeps at most 5, ignores non-strings and non-arrays", () => {
    assert.deepEqual(merchants(["AAAA", "BBBB", "CCCC", "DDDD", "EEEE", "FFFF"]), ["AAAA", "BBBB", "CCCC", "DDDD", "EEEE"]);
    assert.deepEqual(merchants(["AAAA", 5, null, { x: 1 }]), ["AAAA"]);
    assert.equal(merchants("AAAA"), undefined);
  });
  it("cleans pending keywords the same way and leaves out confirmed ones", () => {
    assert.deepEqual(pb(["ACME ROBOTICS"], ["acme robotics", "beta works", "LLC"]).merchantsPending, ["BETA WORKS"]);
    assert.equal(pb(undefined, "x").merchantsPending, undefined);
  });
});

describe("merchantKeyword", () => {
  const cases: [string, string | undefined][] = [
    ["ACME ROBOTICS LLC*1234 SAN FRANCISCO CA", "ACME ROBOTICS"],
    ["ACME CLOUD LLC*1234 SAN FRANCISCO", "ACME"],
    ["SQ *BLUE BOTTLE COFFEE 0123", "BLUE BOTTLE"],
    ["PAYPAL *SPOTIFY 35314369001", "SPOTIFY"],
    ["KLARNA *Nordic Gadgets", "GADGETS"],
    ["ZETTLE_*Cafe Roma", "CAFE ROMA"],
    ["Notion Labs Inc. San Francisco", "NOTION LABS"],
    ["Figma 2026-10-03 49.00 USD", "FIGMA"],
    ["KORTKÖP 241103 SPOTIFY AB STOCKHOLM", "SPOTIFY"],
    ["Kortköp 24-11-03 Åhléns City Stockholm", "ÅHLÉNS CITY"],
    ["Lastschrift 03.11. ACME GMBH BERLIN DE", "ACME"],
    ["TST* Cafe Roma", "CAFE ROMA"],
    ["Swish betalning Anna Svensson", undefined],
    ["ÖVERFÖRING Erik Berg", undefined],
    ["12345 6789", undefined],
    ["PAYPAL *", undefined],
    ["INC LLC", undefined],
    ["X Y Z", undefined],
    ["Betalning till Orsted", undefined],
    ["Autogiro Vattenfall", undefined],
    ["PLUSGIRO 12 34 Foo Bar", undefined],
    ["Transfer to Acme Robotics", undefined],
    ["Payment to Acme Robotics", undefined],
    ["Anna Svensson", undefined],
    ["Jean-Luc Picard", undefined],
    ["Anna Svensson AB", "ANNA SVENSSON"],
  ];
  for (const [text, want] of cases) it(`${JSON.stringify(text)} -> ${JSON.stringify(want)}`, () => assert.equal(merchantKeyword(text), want));
  it("returns at most two words from the allowed characters", () => {
    const k = merchantKeyword("Some Very Long Vendor Name Here*9999")!;
    assert.equal(k, "SOME VERY");
    assert.match(k, /^[A-Z0-9&.' -]+$/);
  });
  it("normaliseMerchant upper-cases, folds diacritics and drops prefix and reference", () => {
    assert.equal(normaliseMerchant("sq *Åhléns*77 x"), "ÅHLÉNS");
    assert.equal(normaliseMerchant("ＡＣＭＥ"), "ACME");
  });
});
