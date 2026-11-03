import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Playbook } from "@pista/protocol";
import { FAIL_THRESHOLD, deletePlaybook, getPlaybook, listPlaybooks, recordFailure, recordSuccess, sanitizeUrl, savePlaybook, siteKey, validatePlaybook } from "./playbooks.ts";

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
    assert.equal(pb.steps.length, 2); // the emptied wait is dropped
    assert.equal((pb.steps[1] as { origin: string }).origin, "https://app.example.com");
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
