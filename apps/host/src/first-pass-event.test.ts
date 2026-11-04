import assert from "node:assert/strict";
import { test } from "node:test";
import type { Playbook } from "@pista/protocol";
import { setupHome } from "./test-helpers.ts";

setupHome("first-pass-event", { cleanup: "exit" });
const { firstPassEvent, runFirstPass } = await import("./first-pass.ts");
const { confirmMerchant, getPlaybook, listPlaybooks, removeMerchant, savePlaybook, setMerchants, dismissMerchant, validatePlaybook } = await import("./playbooks.ts");

function make(site: string, extra: Partial<Playbook> = {}): Playbook {
  const pb = { ...validatePlaybook({ startUrl: `https://${site}/billing`, steps: [{ kind: "download", target: { role: "link", name: "Download" }, fileType: "pdf" }] }, site), ...extra };
  savePlaybook(pb);
  return pb;
}
make("acme.test", { merchants: ["ACME ROBOTICS"] });
make("beta.test", { merchantsPending: ["BETA WORKS"] });
make("gamma.test", { merchantsPending: ["GAMMA"], merchantsPendingWhy: { GAMMA: "short" } });
const all = () => listPlaybooks().map((m) => getPlaybook(m.site)!);

const PASTE = ["2026-01-15 ACME ROBOTICS LLC*1234 -49.00 USD", "2026-01-16 SOMEBODY ELSE -12.00 USD", "2026-01-17 ACME ROBOTICS -20.00 USD", "2026-01-18 BETA WORKS -9.00 USD", "2026-01-19 GAMMA CLOUD -5.00 USD"].join("\n");
const downloaded = (site: string, i: number) => ({ status: "downloaded" as const, site, path: `/private/invoices/2026-01/${site}-${i}.pdf`, bytes: 10, steps: 1, amountVerified: true });

test("the event tells every line apart, carries a learned keyword and the broad ones to ask about, and no raw text", async () => {
  let n = 0;
  const out = (await runFirstPass(PASTE, {
    playbooks: all, allow: async () => true,
    run: async (r) => (++n, r.merchant!.includes("BETA") ? { status: "handoff" as const, site: r.site, reason: "row-not-found" as const, text: "x" } : { ...downloaded(r.site, n), ...(r.site === "acme.test" && n === 1 ? { learned: ["ACME"] } : {}) }),
  }))!;
  const e = firstPassEvent("t1", out, all());
  assert.equal(e.type, "playbook.firstPass");
  assert.deepEqual([e.fetchedCount, e.total], [2, 5]);
  assert.deepEqual(e.lines.map((l) => [l.lineNo, l.status, l.site]), [[1, "fetched", "acme.test"], [2, "unmatched", undefined], [3, "fetched", "acme.test"], [4, "handed-off", "beta.test"], [5, "unmatched", undefined]]);
  assert.deepEqual(e.lines[0], { lineNo: 1, site: "acme.test", status: "fetched", date: "2026-01-15", amount: 49, currency: "USD", file: "acme.test-1.pdf" });
  assert.equal(e.lines[3]!.reason, "row-not-found");
  assert.deepEqual(e.learned, [{ site: "acme.test", keyword: "ACME" }]);
  assert.deepEqual(e.ask, [{ site: "gamma.test", keyword: "GAMMA", why: "short" }]);
  const json = JSON.stringify(e);
  for (const raw of ["SOMEBODY", "ROBOTICS", "LLC", "1234", "/private", "GAMMA CLOUD"]) assert.ok(!json.includes(raw), raw);
});

test("a declined batch and a stopped batch give declined and stopped lines", async () => {
  const declined = (await runFirstPass(PASTE, { playbooks: all, allow: async () => false, run: async () => downloaded("x", 1) }))!;
  const d = firstPassEvent("t1", declined, all());
  assert.deepEqual([d.fetchedCount, ...d.lines.map((l) => l.status)], [0, "declined", "unmatched", "declined", "declined", "unmatched"]);
  const ac = new AbortController();
  const stopped = (await runFirstPass(PASTE, { playbooks: all, allow: async () => true, run: async (r) => (ac.abort(), downloaded(r.site, 1)) }, ac.signal))!;
  assert.deepEqual(firstPassEvent("t1", stopped, all()).lines.map((l) => l.status), ["fetched", "unmatched", "stopped", "stopped", "unmatched"]);
});

test("sizes are bounded", () => {
  const line = (lineNo: number) => ({ lineNo, raw: "x", ok: true, merchant: "M" });
  const rest = Array.from({ length: 300 }, (_, i) => ({ line: line(i + 1) }));
  const learned = Array.from({ length: 30 }, (_, i) => ({ site: "s", keyword: `K${i}` }));
  const e = firstPassEvent("t1", { fetched: [], learned, handedOff: [], declined: [], rest, ran: true }, []);
  assert.deepEqual([e.lines.length, e.total, e.learned.length], [200, 300, 20]);
});

test("removeMerchant takes a confirmed keyword away, including one with a wildcard, and says when it was not there", () => {
  make("delta.test", { merchants: ["DELTA", "DELTA PRO", "PAYPAL*DELTA"] });
  assert.equal(removeMerchant("delta.test", "DELTA"), true);
  assert.deepEqual(getPlaybook("delta.test")!.merchants, ["DELTA PRO", "PAYPAL*DELTA"]);
  assert.equal(removeMerchant("delta.test", "paypal*delta"), true);
  assert.equal(removeMerchant("delta.test", "PAYPAL*DELTA"), false);
  assert.equal(removeMerchant("delta.test", "ZZZ"), false);
  assert.equal(removeMerchant("delta.test", "DELTA PRO"), true);
  assert.equal(getPlaybook("delta.test")!.merchants, undefined);
});

test("confirmMerchant moves a pending keyword over and clears its notes", () => {
  make("eps.test", { merchants: ["EPS ONE"], merchantsPending: ["EPSILON", "OTHER WORD"], merchantsPendingWhy: { EPSILON: "short" }, merchantMisses: { EPSILON: 1 } });
  assert.deepEqual(confirmMerchant("eps.test", "epsilon"), { ok: true });
  const pb = getPlaybook("eps.test")!;
  assert.deepEqual(pb.merchants, ["EPS ONE", "EPSILON"]);
  assert.deepEqual(pb.merchantsPending, ["OTHER WORD"]);
  assert.equal(pb.merchantsPendingWhy?.EPSILON, undefined);
  assert.equal(pb.merchantMisses?.EPSILON, undefined);
});

test("confirmMerchant refuses a keyword that is no longer pending, and changes nothing", () => {
  make("zeta.test", { merchantsPending: ["ZETA CORP", "ZETA TWO"] });
  dismissMerchant("zeta.test", "ZETA CORP");
  assert.deepEqual(confirmMerchant("zeta.test", "ZETA CORP"), { ok: true, refused: "not-pending" });
  setMerchants("zeta.test", ["ZETA TWO"]);
  assert.deepEqual(confirmMerchant("zeta.test", "ZETA TWO"), { ok: true, refused: "not-pending" });
  assert.deepEqual(getPlaybook("zeta.test")!.merchants, ["ZETA TWO"]);
  removeMerchant("zeta.test", "ZETA TWO");
  assert.deepEqual(confirmMerchant("zeta.test", "ZETA TWO"), { ok: true, refused: "not-pending" });
  assert.equal(getPlaybook("zeta.test")!.merchants, undefined);
});

test("confirmMerchant refuses when the list is full, and a keyword that fails the checks", () => {
  make("eta.test", { merchants: ["AAAA ONE", "AAAA TWO", "AAAA THREE", "AAAA FOUR", "AAAA FIVE"], merchantsPending: ["ETA WORKS"] });
  assert.deepEqual(confirmMerchant("eta.test", "ETA WORKS"), { ok: true, refused: "too-many" });
  assert.deepEqual(getPlaybook("eta.test")!.merchantsPending, ["ETA WORKS"]);
  assert.equal(getPlaybook("eta.test")!.merchants!.length, 5);
  make("theta.test", { merchantsPending: ["LLC"] });
  assert.deepEqual(confirmMerchant("theta.test", "LLC"), { ok: true, refused: "too-short" });
  assert.equal(getPlaybook("theta.test")!.merchants, undefined);
});

test("every keyword method rejects an unknown site", () => {
  assert.throws(() => removeMerchant("nope.test", "ACME ROBOTICS"), /no playbook/);
  assert.throws(() => confirmMerchant("nope.test", "ACME ROBOTICS"), /no playbook/);
  assert.throws(() => setMerchants("nope.test", ["ACME ROBOTICS"]), /no playbook/);
  assert.throws(() => dismissMerchant("nope.test", "ACME ROBOTICS"), /no playbook/);
});
