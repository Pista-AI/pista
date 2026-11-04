import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { broadReason, cleanMerchant, keywordMatches } from "./merchants.ts";
import { addPendingMerchant, confirmByProof, getPlaybook, noteMerchantOutcome, recordKeywordHit, recordKeywordMiss, savePlaybook, setMerchants, validatePlaybook } from "./playbooks.ts";

describe("wildcard keywords", () => {
  it("matches an inner * across any run, anchored at word boundaries", () => {
    assert.ok(keywordMatches("ACME*CLOUD", "ACME EU CLOUD INC"));
    assert.ok(keywordMatches("ACME*CLOUD", "ACMECLOUD"));
    assert.ok(!keywordMatches("ACME*CLOUD", "XACME CLOUD"));
    assert.ok(!keywordMatches("ACME*CLOUD", "ACME CLOUDS"));
    assert.ok(keywordMatches("ABC*DEF*CORP", "ABC DEF CORP"));
    assert.ok(!keywordMatches("ABC*DEF*CORP", "ABC CORP DEF"));
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
    assert.equal(cleanMerchant("ACME*CLOUD"), "ACMECLOUD");
    assert.equal(cleanMerchant("ACME*CLOUD", true), "ACME*CLOUD");
    assert.equal(cleanMerchant("*ACME", true), undefined);
    assert.equal(cleanMerchant("ACME*", true), undefined);
    assert.equal(cleanMerchant("ABC*DEF*GHI*JKL", true), undefined);
    assert.equal(cleanMerchant("A*B 1", true), undefined);
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
    setMerchants("example.com", ["GOOGLE CLOUD", "ACME*CLOUD"]);
    const pb = getPlaybook("example.com")!;
    assert.deepEqual([pb.merchants, pb.merchantsPendingWhy], [["GOOGLE CLOUD", "ACME*CLOUD"], undefined]);
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
  it("noteMerchantOutcome counts misses for matching keywords only", () => {
    setMerchants("example.com", ["ACME ROBOTICS"]);
    noteMerchantOutcome("example.com", "ACME ROBOTICS", "miss");
    noteMerchantOutcome("example.com", "UNRELATED", "miss");
    assert.deepEqual(getPlaybook("example.com")!.merchantMisses, { "ACME ROBOTICS": 1 });
  });
  it("validates stored fields", () => {
    const pb = validatePlaybook({ startUrl: "https://example.com/", steps: [], merchants: ["ACME ROBOTICS"], merchantsPending: ["BAD*ONE KEY", "TELNYX"], merchantsPendingWhy: { TELNYX: "unsure", "NOT PENDING": "short", "BADONE KEY": "bogus" }, merchantMisses: { "ACME ROBOTICS": 99, X: 3 } }, "example.com");
    assert.deepEqual(pb.merchantsPendingWhy, { TELNYX: "unsure" });
    assert.deepEqual(pb.merchantMisses, { "ACME ROBOTICS": 1 });
    assert.ok(!pb.merchantsPending!.some((m) => m.includes("*")));
  });
});
