import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";
import { traceOf, type TraceEntry } from "./test-trace-fixtures.ts";

const { projectDir } = setupHome("playbook-routes", { cleanup: "exit" });
const { PlaybookTrace, autoCapture, savePlaybookFromTrace } = await import("./playbook-capture.ts");
const { recordRun, runPlaybookForInvoice, playbookGuardMessage } = await import("./playbook-run.ts");
const { routeLines } = await import("./first-pass.ts");
const { deletePlaybook, getPlaybook, savePlaybook, validatePlaybook, selectRoute, autoRouteKey, setRoute, getRoute } = await import("./playbooks.ts");

const MAIL = "https://mail.google.com/";
const INV = { date: "2026-10-03", amount: 12.5, currency: "EUR" };
const OK = JSON.stringify({ path: "invoices/a.pdf", bytes: 10, contentType: "application/pdf" });
const dl = { kind: "download" as const, source: "ref" as const, locator: { role: "link", name: "Download" }, contentType: "application/pdf", path: "invoices/a.pdf" };
const gmailTrace = (q: string, merchant?: string): ReturnType<typeof traceOf> => {
  const entries: TraceEntry[] = [{ kind: "navigate", url: `${MAIL}mail/u/0/?q=${q}` }, { kind: "click", locator: { role: "link", name: "Invoice mail", text: "Invoice mail" }, urlAfter: `${MAIL}mail/u/0/?q=${q}&open=1` }, dl];
  const t = traceOf(entries, INV);
  t.merchant = merchant;
  return t;
};
const fresh = () => deletePlaybook("google.com");
const dlStep = { kind: "download", target: { role: "link", name: "Download invoice" }, fileType: "pdf" };

test("an old playbook file without routes loads unchanged and its default route is the top-level fields", () => {
  fresh();
  savePlaybook(validatePlaybook({ startUrl: "https://acme.com/billing", steps: [dlStep], successCount: 2 }, "acme.com"));
  const pb = getPlaybook("acme.com")!;
  assert.equal(pb.routes, undefined);
  assert.equal(getRoute(pb)!.successCount, 2);
  assert.equal(getRoute(pb, "invoice:x"), undefined);
});

test("route keys: valid ones kept, bad ones rejected on set and dropped on load", () => {
  const pb = validatePlaybook({ startUrl: "https://acme.com/", steps: [], routes: { "invoice:a": { startUrl: "https://acme.com/a", steps: [dlStep] }, "Bad Key": { startUrl: "https://acme.com/b", steps: [dlStep] }, "": { startUrl: "https://acme.com/c", steps: [dlStep] } } }, "acme.com");
  assert.deepEqual(Object.keys(pb.routes ?? {}), ["invoice:a"]);
  const r = getRoute(pb, "invoice:a")!;
  for (const bad of ["Invoice", ":x", "a b", "x".repeat(65), "../x"]) assert.throws(() => setRoute(pb, bad, r), /invalid route key/);
  assert.deepEqual(selectRoute(pb, "Nope"), { error: "invalid route key" });
  const saved = savePlaybookFromTrace(gmailTrace("a").list(), [1, 2, 3], undefined, "t", INV, undefined, undefined, undefined, { route: "Bad Key" });
  assert.match(saved.message, /^Not saved: invalid route key/);
});

test("capture with a merchant on a third-party site creates invoice:<slug>; a second merchant adds a second route and leaves the first", () => {
  fresh();
  const a = autoCapture(gmailTrace("openai", "OPENAI"), OK, "t");
  assert.match(a.note ?? "", /route invoice:openai/);
  let pb = getPlaybook("google.com")!;
  assert.deepEqual(Object.keys(pb.routes!), ["invoice:openai"]);
  assert.equal(pb.steps.length, 0, "the default route is untouched");
  const first = JSON.stringify(pb.routes!["invoice:openai"]!.steps);
  assert.match(pb.routes!["invoice:openai"]!.startUrl, /q=openai/);

  autoCapture(gmailTrace("telia", "TELIA SVERIGE AB"), OK, "t");
  pb = getPlaybook("google.com")!;
  assert.deepEqual(Object.keys(pb.routes!).sort(), ["invoice:openai", "invoice:telia"]);
  assert.equal(JSON.stringify(pb.routes!["invoice:openai"]!.steps), first);
  assert.match(pb.routes!["invoice:openai"]!.startUrl, /q=openai/);
  assert.match(pb.routes!["invoice:telia"]!.startUrl, /q=telia/);

  // Re-capturing the same route with a different start replaces only that route.
  autoCapture(gmailTrace("openai2", "OPENAI"), OK, "t");
  pb = getPlaybook("google.com")!;
  assert.match(pb.routes!["invoice:openai"]!.startUrl, /q=openai2/);
  assert.match(pb.routes!["invoice:telia"]!.startUrl, /q=telia/);
});

test("a merchant on its own site, or none, captures the default route; the host judges own-site by name", () => {
  assert.equal(autoRouteKey("OPENAI", "openai.com"), undefined);
  assert.equal(autoRouteKey("TELIA SVERIGE", "google.com"), "invoice:telia");
  assert.equal(autoRouteKey(undefined, "google.com"), undefined);
  fresh();
  autoCapture(gmailTrace("none"), OK, "t");
  const pb = getPlaybook("google.com")!;
  assert.equal(pb.routes, undefined);
  assert.ok(pb.steps.length > 0);
});

test("an explicit route key on playbook_save's path wins over the automatic one", () => {
  fresh();
  const t = gmailTrace("x", "OPENAI");
  const r = savePlaybookFromTrace(t.list(), [1, 2, 3], undefined, "t", INV, "OPENAI", undefined, undefined, { route: "ticket:book" });
  assert.match(r.message, /route ticket:book/);
  assert.deepEqual(Object.keys(getPlaybook("google.com")!.routes!), ["ticket:book"]);
});

function twoRoutes(): void {
  fresh();
  const pb = validatePlaybook({ startUrl: `${MAIL}default`, steps: [dlStep], merchants: ["OPENAI", "TELIA"], routes: {
    "invoice:openai": { startUrl: `${MAIL}openai`, steps: [dlStep] },
    "invoice:telia": { startUrl: `${MAIL}telia`, steps: [dlStep] },
  } }, "google.com");
  savePlaybook(pb);
}
const done = { ok: true as const, download: { path: "invoices/a.pdf", bytes: 10 }, steps: 1, verified: { date: false, amount: false }, urls: ["", ""] };
const fail = { ok: false as const, failedIndex: 1, step: { kind: "download" as const }, reason: "not-found" as const, detail: "", url: "", snapshot: "" };

test("playbook_run picks the route by merchant, and records on that route only", async () => {
  twoRoutes();
  mkdirSync(join(projectDir, "invoices"), { recursive: true });
  const seen: string[] = [];
  const deps = { driver: () => ({}) as never, downloadRoot: () => projectDir, trace: new PlaybookTrace(), attempted: new Set<string>(), confirmRisk: async () => false, emit: () => {}, threadId: "t", replay: (async (pb: { startUrl: string }) => (seen.push(pb.startUrl), done)) as never };
  const consent = { approve: async () => true, approvalMode: () => "full-access" as const, confirmSignIns: () => undefined, policy: () => undefined };
  const run = (p: Record<string, unknown>) => runPlaybookForInvoice(deps as never, consent as never, { site: "google.com", invoice: { date: "2026-10-03" }, path: `invoices/r${seen.length}.pdf`, ...p });
  const a = await run({ merchant: "TELIA SVERIGE" });
  assert.equal(a.status === "downloaded" && a.route, "invoice:telia");
  const b = await run({ merchant: "something else" });
  assert.equal(b.status === "downloaded" && b.route, undefined, "no route for the merchant: the default");
  const c = await run({ route: "invoice:openai" });
  assert.equal(c.status === "downloaded" && c.route, "invoice:openai");
  assert.deepEqual(seen, [`${MAIL}telia`, `${MAIL}default`, `${MAIL}openai`]);
  const pb = getPlaybook("google.com")!;
  assert.deepEqual([pb.routes!["invoice:telia"]!.successCount, pb.routes!["invoice:openai"]!.successCount, pb.successCount], [1, 1, 1]);
  const bad = await run({ route: "invoice:nope" });
  assert.equal(bad.status, "error");
});

test("a failure counts on its route; needs-attention on one route leaves the others runnable", () => {
  twoRoutes();
  for (let i = 0; i < 3; i++) recordRun("google.com", fail, "t", INV, 1, "invoice:telia");
  let pb = getPlaybook("google.com")!;
  assert.deepEqual([pb.routes!["invoice:telia"]!.status, pb.routes!["invoice:telia"]!.failCount, pb.routes!["invoice:openai"]!.status, pb.status, pb.failCount], ["needs-attention", 3, "ok", "ok", 0]);
  const ev = recordRun("google.com", fail, "t", INV, 1, "invoice:openai");
  assert.ok(ev.length);
  recordRun("google.com", done, "t", INV, 1, "invoice:openai");
  pb = getPlaybook("google.com")!;
  assert.equal(pb.routes!["invoice:openai"]!.failCount, 0);
  assert.equal(pb.routes!["invoice:telia"]!.failCount, 3);

  const lines = [
    { ok: true, merchant: "TELIA SVERIGE", date: "2026-10-03", amount: -10 },
    { ok: true, merchant: "OPENAI", date: "2026-10-03", amount: -10 },
  ] as never;
  const r = routeLines(lines, [pb]);
  assert.deepEqual(r.routed.map((x) => x.site), ["google.com"]);
  assert.equal(r.rest.length, 1);
  assert.match(String((r.rest[0] as { why?: string }).why), /invoice:telia needs attention/);
});

test("a playbook with routes only has a path: the guard applies and a keyword-less run lists the routes", async () => {
  fresh();
  const pb = validatePlaybook({ startUrl: `${MAIL}`, steps: [], routes: { "invoice:openai": { startUrl: `${MAIL}openai`, steps: [dlStep] } } }, "google.com");
  savePlaybook(pb);
  assert.match(playbookGuardMessage(new Set(), "browser_navigate", { url: `${MAIL}x` }) ?? "", /Blocked/);
  const deps = { driver: () => ({}) as never, downloadRoot: () => projectDir, trace: new PlaybookTrace(), attempted: new Set<string>(), confirmRisk: async () => false, emit: () => {}, threadId: "t", replay: (async () => done) as never };
  const consent = { approve: async () => true, approvalMode: () => "full-access" as const, confirmSignIns: () => undefined, policy: () => undefined };
  const r = await runPlaybookForInvoice(deps as never, consent as never, { site: "google.com", invoice: { date: "2026-10-03" }, path: "invoices/z.pdf" }, undefined);
  assert.equal(r.status, "no-playbook");
  assert.match(r.text, /routes: invoice:openai/);
});
