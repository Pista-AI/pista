import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { broadReason, cleanMerchant, keywordMatches } from "./merchants.ts";
import { addPendingMerchant, confirmByProof, getPlaybook, noteMerchantOutcome, recordKeywordHit, recordKeywordMiss, transactionKey, savePlaybook, setMerchants, validatePlaybook } from "./playbooks.ts";

describe("wildcard keywords", () => {
  it("matches an inner * across any run, anchored at word boundaries", () => {
    assert.ok(keywordMatches("ACME*DEPOT", "ACME EU DEPOT INC"));
    assert.ok(keywordMatches("ACME*DEPOT", "ACMEDEPOT"));
    assert.ok(!keywordMatches("ACME*DEPOT", "XACME DEPOT"));
    assert.ok(!keywordMatches("ACME*DEPOT", "ACME DEPOTS"));
    assert.ok(keywordMatches("ABC*DEF*CORP", "ABC DEF CORP"));
    assert.ok(!keywordMatches("ABC*DEF*CORP", "ABC CORP DEF"));
  });
  it("matches text that has a * in it", () => {
    assert.ok(keywordMatches("ADOBE CREATIVE", "ADOBE *CREATIVE DEPOT"));
    assert.ok(keywordMatches("ADOBE*CREATIVE", "ADOBE *CREATIVE DEPOT"));
    assert.ok(keywordMatches("TELNYX", "PAYPAL *TELNYX"));
    assert.ok(!keywordMatches("ADOBE", "ADOBEX*CREATIVE"));
  });
  it("keeps plain keywords whole-word", () => {
    assert.ok(keywordMatches("ACME", "SQ *Acme AB"));
    assert.ok(!keywordMatches("ACME", "ACMEX"));
  });
  it("stays fast on pathological input", () => {
    const text = "A".repeat(5000);
    const t = Date.now();
    assert.ok(!keywordMatches("AAA*AAA*AAAB", text));
    assert.ok(!keywordMatches("AAAA*AAAA*B", text));
    assert.ok(Date.now() - t < 200);
  });
  it("only allows wildcards for the user, with limits", () => {
    assert.equal(cleanMerchant("ACME*DEPOT"), "ACMEDEPOT");
    assert.equal(cleanMerchant("ACME*DEPOT", true), "ACME*DEPOT");
    assert.equal(cleanMerchant("*ACME", true), undefined);
    assert.equal(cleanMerchant("ACME*", true), undefined);
    assert.equal(cleanMerchant("ABC*DEF*GHI*JKL", true), undefined);
    assert.equal(cleanMerchant("A*B 1", true), undefined);
    assert.equal(cleanMerchant("ACME**DEPOT", true), undefined);
    assert.equal(cleanMerchant("THE*INC", true), undefined);
    assert.equal(cleanMerchant("ACME*INC", true), undefined);
    assert.equal(cleanMerchant("ACME*DEPOT", true), "ACME*DEPOT");
  });
});

describe("broadReason", () => {
  it("flags short, umbrella, other-site and unsure keywords", () => {
    assert.equal(broadReason("ACM"), "short");
    assert.equal(broadReason("GOOGLE CLOUD"), "umbrella");
    assert.equal(broadReason("ACME", { otherSites: ["ACME"] }), "other-site");
    assert.equal(broadReason("ACME", { unsure: true }), "unsure");
    assert.equal(broadReason("ACME", { unverifiedElsewhere: true }), "unverified-elsewhere");
    assert.equal(broadReason("ACME ROBOTICS"), undefined);
  });
});

describe("keyword proof and misses", () => {
  const prev = process.env.PISTA_HOME;
  beforeEach(() => {
    process.env.PISTA_HOME = mkdtempSync(join(tmpdir(), "pista-kw-"));
    for (const site of ["example.com", "other.com"]) savePlaybook(validatePlaybook({ startUrl: `https://${site}/in`, steps: [{ kind: "navigate", url: `https://${site}/invoices` }] }, site));
  });
  afterEach(() => { if (prev === undefined) delete process.env.PISTA_HOME; else process.env.PISTA_HOME = prev; });

  it("confirms a specific pending keyword when a verified download matches", () => {
    addPendingMerchant("example.com", "ACME ROBOTICS");
    assert.deepEqual(confirmByProof("example.com", "SQ *ACME ROBOTICS LLC*123"), ["ACME ROBOTICS"]);
    const pb = getPlaybook("example.com")!;
    assert.deepEqual([pb.merchants, pb.merchantsPending], [["ACME ROBOTICS"], undefined]);
  });
  it("does not confirm on a non-matching merchant", () => {
    addPendingMerchant("example.com", "ACME ROBOTICS");
    assert.deepEqual(confirmByProof("example.com", "OTHER SHOP"), []);
    assert.deepEqual(getPlaybook("example.com")!.merchantsPending, ["ACME ROBOTICS"]);
  });
  it("keeps broad keywords pending with the reason", () => {
    addPendingMerchant("example.com", "GOOGLE CLOUD");
    addPendingMerchant("example.com", "ACME ROBOTICS", { unsure: true });
    addPendingMerchant("other.com", "SHARED NAME");
    addPendingMerchant("example.com", "SHARED NAME");
    assert.deepEqual(confirmByProof("example.com", "GOOGLE CLOUD ACME ROBOTICS SHARED NAME"), []);
    const pb = getPlaybook("example.com")!;
    assert.equal(pb.merchants, undefined);
    assert.deepEqual(pb.merchantsPendingWhy, { "GOOGLE CLOUD": "umbrella", "ACME ROBOTICS": "unsure", "SHARED NAME": "other-site" });
  });
  it("the user confirming a broad keyword clears its reason; wildcards survive", () => {
    addPendingMerchant("example.com", "GOOGLE CLOUD");
    setMerchants("example.com", ["GOOGLE CLOUD", "ACME*DEPOT"]);
    const pb = getPlaybook("example.com")!;
    assert.deepEqual([pb.merchants, pb.merchantsPendingWhy], [["GOOGLE CLOUD", "ACME*DEPOT"], undefined]);
  });
  it("drops a confirmed keyword after 2 consecutive misses; a hit resets", () => {
    setMerchants("example.com", ["ACME ROBOTICS"]);
    assert.equal(recordKeywordMiss("example.com", "ACME ROBOTICS"), false);
    recordKeywordHit("example.com", "ACME ROBOTICS");
    assert.equal(getPlaybook("example.com")!.merchantMisses, undefined);
    recordKeywordMiss("example.com", "ACME ROBOTICS");
    assert.equal(recordKeywordMiss("example.com", "ACME ROBOTICS"), true);
    const pb = getPlaybook("example.com")!;
    assert.deepEqual([pb.merchants, pb.merchantMisses], [undefined, undefined]);
  });
  it("counts a miss once, for the most specific matching keyword", () => {
    setMerchants("example.com", ["ACME", "ACME ROBOTICS"]);
    noteMerchantOutcome("example.com", "ACME ROBOTICS", "miss", { txKey: "aaaaaaaaaaaa" });
    noteMerchantOutcome("example.com", "UNRELATED", "miss", { txKey: "bbbbbbbbbbbb" });
    assert.deepEqual(getPlaybook("example.com")!.merchantMisses, { "ACME ROBOTICS": 1 });
  });
  it("ignores a retry of the same transaction and drops after 2 different ones", () => {
    setMerchants("example.com", ["ACME ROBOTICS"]);
    const a = transactionKey({ date: "2026-10-01", amount: 10 }), b = transactionKey({ date: "2026-10-02", amount: 10 });
    assert.match(a, /^[0-9a-f]{12}$/);
    for (let i = 0; i < 3; i++) assert.equal(recordKeywordMiss("example.com", "ACME ROBOTICS", a), false);
    assert.deepEqual(getPlaybook("example.com")!.merchantMisses, { "ACME ROBOTICS": 1 });
    assert.equal(recordKeywordMiss("example.com", "ACME ROBOTICS", b), true);
    assert.equal(getPlaybook("example.com")!.merchants, undefined);
  });
  it("re-saving a keyword resets its misses", () => {
    setMerchants("example.com", ["ACME ROBOTICS"]);
    recordKeywordMiss("example.com", "ACME ROBOTICS", "aaaaaaaaaaaa");
    setMerchants("example.com", ["ACME ROBOTICS"]);
    assert.equal(getPlaybook("example.com")!.merchantMisses, undefined);
  });
  it("confirms by proof only when the amount was verified", () => {
    addPendingMerchant("example.com", "ACME ROBOTICS");
    noteMerchantOutcome("example.com", "ACME ROBOTICS", "hit", { amountVerified: false });
    assert.equal(getPlaybook("example.com")!.merchants, undefined);
    noteMerchantOutcome("example.com", "ACME *ROBOTICS", "hit", { amountVerified: true });
    assert.deepEqual(getPlaybook("example.com")!.merchants, ["ACME ROBOTICS"]);
  });
  it("validates stored fields", () => {
    const pb = validatePlaybook({ startUrl: "https://example.com/", steps: [], merchants: ["ACME ROBOTICS"], merchantsPending: ["BAD*ONE KEY", "TELNYX"], merchantsPendingWhy: { TELNYX: "unsure", "NOT PENDING": "short", "BADONE KEY": "bogus" }, merchantMisses: { "ACME ROBOTICS": 99, X: 3 } }, "example.com");
    assert.deepEqual(pb.merchantsPendingWhy, { TELNYX: "unsure" });
    assert.deepEqual(pb.merchantMisses, { "ACME ROBOTICS": 1 });
    assert.ok(!pb.merchantsPending!.some((m) => m.includes("*")));
  });
});
