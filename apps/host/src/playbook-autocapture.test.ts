import assert from "node:assert/strict";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("playbook-autocapture", { cleanup: "exit" });
const { PlaybookTrace, autoCapture } = await import("./playbook-capture.ts");
const { formatHandoff, recordRun } = await import("./playbook-run.ts");
const { getPlaybook, savePlaybook, validatePlaybook, deletePlaybook } = await import("./playbooks.ts");

const B = "https://billing.example.com/";
const INV = { date: "2026-10-03", amount: 12.5, currency: "EUR" };
const OK = JSON.stringify({ path: "invoices/a.pdf", bytes: 10, contentType: "application/pdf" });
const dl = { kind: "download" as const, source: "ref" as const, locator: { role: "link", name: "Download" }, contentType: "application/pdf", path: "invoices/a.pdf" };
const click = { kind: "click" as const, locator: { role: "link", name: "Invoices", text: "Invoices" }, urlAfter: `${B}invoices` };

function trace(entries: Parameters<InstanceType<typeof PlaybookTrace>["add"]>[0][], invoice: unknown = INV) {
  const t = new PlaybookTrace();
  for (const e of entries) t.add(e);
  if (invoice) t.invoice = invoice;
  return t;
}
const fresh = () => deletePlaybook("example.com");

test("a download with a navigate/click path and an invoice in context is saved by the host, with a note", () => {
  fresh();
  const t = trace([{ kind: "navigate", url: "https://elsewhere.org/" }, { kind: "navigate", url: B }, click, dl]);
  const r = autoCapture(t, OK, "t1");
  assert.match(r.note ?? "", /^Saved a playbook for example\.com \(2 steps, unchecked\)\.$/);
  assert.equal(r.event?.type, "playbook.event");
  const pb = getPlaybook("example.com")!;
  assert.deepEqual(pb.steps.map((s) => s.kind), ["click", "download"]);
  assert.equal(pb.startUrl, B);
  assert.ok(pb.history.some((h) => h.summary === "captured by host"));
});

test("nothing is saved for a refused download, no invoice, an off-path sign-in or an internal host", () => {
  fresh();
  const path = [{ kind: "navigate" as const, url: B }, click, dl];
  assert.deepEqual(autoCapture(trace(path), JSON.stringify({ rejected: "not-an-invoice", site: "example.com" }), "t"), {});
  assert.deepEqual(autoCapture(trace(path, null), OK, "t"), {});
  assert.deepEqual(autoCapture(trace([{ kind: "signIn", origin: "https://login.other.org" }, ...path]), OK, "t"), {});
  const local = [{ kind: "navigate" as const, url: "http://127.0.0.1:8765/" }, { ...click, urlAfter: "http://127.0.0.1:8765/invoices" }, dl];
  assert.deepEqual(autoCapture(trace(local), OK, "t"), {});
  assert.equal(getPlaybook("example.com"), null);
});

test("a path that cannot be saved says why and points at playbook_save", () => {
  fresh();
  const r = autoCapture(trace([{ kind: "navigate", url: B }, { ...dl, locator: undefined, url: `${B}inv.pdf`, source: "url" }]), OK, "t");
  assert.match(r.note ?? "", /^Not captured automatically: .*Call playbook_save/);
});

test("after a handoff, the model's download repairs the playbook: replayed steps kept, failCount reset, history line", () => {
  fresh();
  savePlaybook(validatePlaybook({ startUrl: B, steps: [{ kind: "click", target: { role: "link", name: "Invoices" } }, { kind: "click", target: { role: "link", name: "Old button" } }, { kind: "download", target: { role: "link", name: "Download" }, fileType: "pdf" }] }, "example.com"));
  recordRun("example.com", { ok: false, failedIndex: 2, step: { kind: "download" }, reason: "not-found", detail: "", url: "", snapshot: "" }, "t", INV, 3);
  assert.equal(getPlaybook("example.com")!.failCount, 1);
  const t = trace([
    { kind: "navigate", url: B },
    { kind: "replayed", index: 1, step: { kind: "click", target: { role: "link", name: "Invoices" } } },
    { kind: "click", locator: { role: "button", name: "New button", text: "New button" }, urlAfter: `${B}invoices/all` },
    dl,
  ]);
  const r = autoCapture(t, OK, "t");
  assert.match(r.note ?? "", /^Saved a playbook for example\.com/);
  const pb = getPlaybook("example.com")!;
  assert.deepEqual([pb.status, pb.failCount, pb.steps.length], ["ok", 0, 3]);
  assert.equal(pb.steps[1]!.kind === "click" && pb.steps[1]!.target.name, "New button");
  assert.ok(pb.history.some((h) => h.summary.startsWith("repaired after handoff at step 2")));
});

test("the handoff names the step, detail, page and recent history", () => {
  const r = { ok: false as const, failedIndex: 2, step: { kind: "click" as const, target: { role: "link", name: "Old button" } }, reason: "not-found" as const, detail: "no such link on the page", url: `${B}invoices`, snapshot: "" };
  const text = formatHandoff("example.com", INV, 3, r, "", [{ summary: "replay failed: blocked" }, { summary: "replay failed: not-found" }]);
  assert.match(text, /step 2 of 3 \(click link "Old button"\)/);
  assert.match(text, /Detail: no such link on the page/);
  assert.match(text, /Page: https:\/\/billing\.example\.com\/invoices/);
  assert.match(text, /Recent history[^]*- replay failed: blocked\n- replay failed: not-found/);
});

const row = (i: number) => ({ texts: ["2026-09-01 10.00", "2026-10-03 12.50", "2026-11-01 7.00"], clickedIndex: i });
const rowClick = (i: number, urlAfter: string) => ({ kind: "click" as const, locator: { role: "link", name: `Row ${i}`, text: `Row ${i}` }, urlAfter, rowContext: row(i) });

test("a dead-end click on a different row is pruned, a loop is removed, a menu click without an address change stays", () => {
  fresh();
  const dead = autoCapture(trace([{ kind: "navigate", url: B }, rowClick(0, `${B}d0`), rowClick(1, `${B}d1`), { ...dl, rowContext: row(1) }]), OK, "t");
  assert.match(dead.note ?? "", /^Saved a playbook/);
  assert.equal(getPlaybook("example.com")!.steps.length, 2, "the click on the other row is gone");
  fresh();
  const loop = autoCapture(trace([{ kind: "navigate", url: B }, { ...click, urlAfter: `${B}away` }, { ...click, locator: { role: "link", name: "Back", text: "Back" }, urlAfter: B }, click, dl]), OK, "t");
  assert.match(loop.note ?? "", /\(2 steps/);
  fresh();
  const menu = autoCapture(trace([{ kind: "navigate", url: B }, click, { kind: "click", locator: { role: "button", name: "More", text: "More" }, urlAfter: `${B}invoices` }, dl]), OK, "t");
  assert.match(menu.note ?? "", /\(3 steps/);
});

test("a download with no row or page text is reported as unchecked", () => {
  fresh();
  assert.match(autoCapture(trace([{ kind: "navigate", url: B }, click, dl]), OK, "t").note ?? "", /unchecked\)\.$/);
});

test("a capture clears the invoice and merchant, so the next vendor does not get the previous keyword", () => {
  fresh();
  const t = trace([{ kind: "navigate", url: B }, click, dl]);
  t.merchant = "ACME HOSTING";
  autoCapture(t, OK, "t");
  assert.equal(t.invoice, undefined);
  assert.equal(t.merchant, undefined);
  assert.deepEqual(getPlaybook("example.com")!.merchantsPending, ["ACME"]);
  const other = trace([{ kind: "navigate", url: "https://billing.other.org/" }, { ...click, urlAfter: "https://billing.other.org/invoices" }, dl]);
  autoCapture(other, OK, "t");
  assert.ok(!(getPlaybook("other.org")?.merchantsPending ?? []).some((k) => /acme/i.test(k)));
});

test("a handoff at the start page leaves no replayed entries; the next download is captured and the failCount resets", () => {
  fresh();
  savePlaybook(validatePlaybook({ startUrl: B, steps: [{ kind: "click", target: { role: "link", name: "Gone" } }, { kind: "download", target: { role: "link", name: "Download" }, fileType: "pdf" }] }, "example.com"));
  recordRun("example.com", { ok: false, failedIndex: 1, step: { kind: "download" }, reason: "not-found", detail: "", url: "", snapshot: "" }, "t", INV, 2);
  autoCapture(trace([{ kind: "navigate", url: B }, click, dl]), OK, "t");
  const pb = getPlaybook("example.com")!;
  assert.deepEqual([pb.status, pb.failCount], ["ok", 0]);
  assert.ok(pb.history.some((h) => h.summary.startsWith("captured by host")));
});

test("first-time capture: playbook_run finds no playbook, the model explores and downloads, the host saves it", async () => {
  fresh();
  const { runPlaybookForInvoice, hostConsent } = await import("./playbook-run.ts");
  const t = new PlaybookTrace();
  const consent = hostConsent({ store: { config: { approvalMode: "full-access" }, toolRules: undefined }, approve: async () => true });
  const r = await runPlaybookForInvoice({ trace: t, attempted: new Set(), driver: () => ({}) as never, downloadRoot: () => "/tmp", confirmRisk: (async () => true) as never, emit: () => {}, threadId: "t" }, consent, { site: "billing.example.com", invoice: INV });
  assert.equal(r.status, "no-playbook");
  for (const e of [{ kind: "navigate" as const, url: B }, click, dl]) t.add(e);
  assert.match(autoCapture(t, OK, "t").note ?? "", /^Saved a playbook/);
});

test("a handoff on the second host is repaired with both hosts", () => {
  fresh();
  deletePlaybook("shop.test");
  const A = "https://shop.test/";
  savePlaybook(validatePlaybook({ startUrl: A, hosts: ["shop.test", "example.com"], steps: [{ kind: "click", target: { role: "link", name: "Pay portal" } }, { kind: "navigate", url: `${B}portal` }, { kind: "download", target: { role: "link", name: "Old" }, fileType: "pdf" }] }, "shop.test"));
  const t = trace([
    { kind: "navigate", url: A },
    { kind: "replayed", index: 1, step: { kind: "click", target: { role: "link", name: "Pay portal" } } },
    { kind: "replayed", index: 2, step: { kind: "navigate", url: `${B}portal` } },
    { kind: "click", locator: { role: "link", name: "Invoices", text: "Invoices" }, urlAfter: `${B}invoices` },
    dl,
  ]);
  assert.match(autoCapture(t, OK, "t").note ?? "", /^Saved a playbook for shop\.test/);
  const pb = getPlaybook("shop.test")!;
  assert.deepEqual(pb.hosts.sort(), ["example.com", "shop.test"]);
  assert.ok(pb.history.some((h) => h.summary.startsWith("repaired after handoff at step 3")));
});
