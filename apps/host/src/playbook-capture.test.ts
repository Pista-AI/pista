import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { PlaybookTrace, TRACE_LIMIT, describeTrace, savePlaybookFromTrace } from "./playbook-capture.ts";
import { getPlaybook, recordFailure, savePlaybook } from "./playbooks.ts";

const B = "http://127.0.0.1:8765/invoices/";
function trace(extra: Parameters<PlaybookTrace["add"]>[0][] = []) {
  const t = new PlaybookTrace();
  t.add({ kind: "navigate", url: `${B}login.html` }); // 1
  t.add({ kind: "navigate", url: `${B}home.html` }); // 2
  t.add({ kind: "click", locator: { role: "link", name: "Overview", text: "Overview" }, urlAfter: `${B}home.html` }); // 3 dead end
  t.add({ kind: "click", locator: { role: "link", name: "Billing", text: "Billing" }, urlAfter: `${B}billing.html` }); // 4
  t.add({ kind: "navigate", url: `${B}list.html` }); // 5
  t.add({ kind: "download", source: "url", url: `${B}inv-001.pdf`, contentType: "application/pdf", path: "invoices/a.pdf" }); // 6
  for (const e of extra) t.add(e);
  return t;
}

beforeEach(() => {
  process.env.PISTA_HOME = mkdtempSync(join(tmpdir(), "playbook-capture-"));
});

describe("playbook_save", () => {
  it("lists the numbered trace compactly", () => {
    const text = describeTrace(trace().list());
    assert.equal(text.split("\n").length, 6);
    assert.match(text, /^4 click link "Billing" -> .*billing\.html$/m);
    assert.match(text, /^6 download .*inv-001\.pdf \(application\/pdf, address given by you\)$/m);
  });

  it("keeps at most the last 200 entries, numbers never repeat", () => {
    const t = new PlaybookTrace();
    for (let i = 0; i < TRACE_LIMIT + 5; i++) t.add({ kind: "navigate", url: `${B}p${i}.html` });
    assert.equal(t.list().length, TRACE_LIMIT);
    assert.equal(t.list()[0]!.n, 6);
  });

  it("builds a playbook from the chosen entries and emits learned", () => {
    const r = savePlaybookFromTrace(trace().list(), [2, 4, 5, 6], { "4": "Your invoices" }, "t1");
    assert.deepEqual(r.event, { type: "playbook.event", threadId: "t1", kind: "learned", site: "127.0.0.1" });
    const pb = getPlaybook("127.0.0.1")!;
    assert.equal(pb.startUrl, `${B}home.html`);
    assert.deepEqual(pb.steps, [
      { kind: "click", target: { role: "link", name: "Billing", text: "Billing" }, expect: { text: "Your invoices", urlIncludes: "/invoices/billing.html" } },
      { kind: "navigate", url: `${B}list.html` },
      { kind: "download", url: `${B}inv-001.pdf`, fileType: "pdf" },
    ]);
  });

  it("rejects a path without a start navigate, with a non-download tail, with unknown entries or from another site", () => {
    const rows = trace([{ kind: "download", source: "url", url: "http://localhost:1/x.pdf", path: "x.pdf" }]).list(); // 7, other site
    const bad = (steps: number[], re: RegExp) => assert.match(savePlaybookFromTrace(rows, steps, undefined, "t").message, re);
    bad([4, 6], /first chosen entry must be a navigate/);
    bad([2, 4], /last chosen entry must be the download/);
    bad([2, 99], /no entry 99/);
    bad([2, 7], /different site/);
    bad([6, 2], /increasing order/);
    assert.equal(getPlaybook("127.0.0.1"), null);
  });

  it("an existing playbook is updated in place: same path changes nothing, a new path emits updated with the first changed step", () => {
    const rows = trace().list();
    savePlaybookFromTrace(rows, [2, 4, 5, 6], undefined, "t");
    assert.equal(savePlaybookFromTrace(rows, [2, 4, 5, 6], undefined, "t").event, undefined);
    const r = savePlaybookFromTrace(rows, [2, 5, 6], undefined, "t");
    assert.deepEqual(r.event, { type: "playbook.event", threadId: "t", kind: "updated", site: "127.0.0.1", step: 1 });
    const pb = getPlaybook("127.0.0.1")!;
    assert.equal(pb.steps.length, 2);
    assert.match(pb.history.at(-1)!.summary, /changed steps? 1,2/);
  });

  it("re-recording resets status and the failure count", () => {
    const rows = trace().list();
    savePlaybookFromTrace(rows, [2, 4, 5, 6], undefined, "t");
    for (let i = 0; i < 3; i++) recordFailure("127.0.0.1");
    assert.equal(getPlaybook("127.0.0.1")!.status, "needs-attention");
    savePlaybookFromTrace(rows, [2, 5, 6], undefined, "t");
    const pb = getPlaybook("127.0.0.1")!;
    assert.equal(pb.status, "ok");
    assert.equal(pb.failCount, 0);
  });

  it("saving the identical path counts as a success: status ok, failures reset, no event", () => {
    const rows = trace().list();
    savePlaybookFromTrace(rows, [2, 4, 5, 6], undefined, "t");
    for (let i = 0; i < 3; i++) recordFailure("127.0.0.1");
    const r = savePlaybookFromTrace(rows, [2, 4, 5, 6], undefined, "t");
    assert.equal(r.event, undefined);
    const pb = getPlaybook("127.0.0.1")!;
    assert.equal(pb.status, "ok");
    assert.equal(pb.failCount, 0);
    assert.equal(pb.successCount, 1);
    assert.ok(pb.lastSucceeded);
  });

  it("a changed start URL is reported as step 1", () => {
    const rows = trace().list();
    savePlaybookFromTrace(rows, [2, 5, 6], undefined, "t");
    const r = savePlaybookFromTrace(rows, [1, 5, 6], undefined, "t");
    assert.equal(r.event?.type === "playbook.event" && r.event.step, 1);
    assert.match(getPlaybook("127.0.0.1")!.history.at(-1)!.summary, /start URL changed/);
  });

  it("a sign-in entry becomes a signIn step; a download from a ref keeps its locator", () => {
    const t = new PlaybookTrace();
    t.add({ kind: "navigate", url: `${B}login.html` }); // 1
    t.add({ kind: "signIn", origin: "http://127.0.0.1:8765" }); // 2
    t.add({ kind: "download", source: "ref", locator: { role: "link", name: "Download invoice", text: "Download invoice" }, contentType: "application/pdf", path: "a.pdf" }); // 3
    assert.match(describeTrace(t.list()), /from the page/);
    savePlaybookFromTrace(t.list(), [1, 2, 3], undefined, "t");
    assert.deepEqual(getPlaybook("127.0.0.1")!.steps, [
      { kind: "signIn", origin: "http://127.0.0.1:8765" },
      { kind: "download", target: { role: "link", name: "Download invoice", text: "Download invoice" }, fileType: "pdf" },
    ]);
  });

  it("urlIncludes compares with the previous chosen page, not the previous recorded one", () => {
    // Entry 3 (dead end) is skipped; entry 4 goes from home.html to billing.html, so the path counts as changed.
    savePlaybookFromTrace(trace().list(), [2, 4, 6], undefined, "t");
    assert.equal((getPlaybook("127.0.0.1")!.steps[0] as { expect?: { urlIncludes?: string } }).expect?.urlIncludes, "/invoices/billing.html");
  });

  it("waitFor: opaque text is dropped, long text is cut, unknown keys are ignored", () => {
    const opaque = "a1".repeat(20) + "-" + "b2".repeat(15);
    savePlaybookFromTrace(trace().list(), [2, 4, 5, 6], { "4": opaque, "5": "x".repeat(500), "99": "ignored" }, "t");
    const [click, nav] = getPlaybook("127.0.0.1")!.steps as { expect?: { text?: string } }[];
    assert.equal(click!.expect?.text, undefined);
    assert.equal(nav!.expect?.text?.length, 200);
  });

  it("opaque-looking names and text are not stored, and an evicted entry number is rejected", () => {
    const tok = "a1".repeat(20) + "-" + "b2".repeat(15);
    const t = new PlaybookTrace();
    t.add({ kind: "navigate", url: `${B}home.html` }); // 1, evicted below
    t.add({ kind: "click", locator: { role: "button", name: tok, text: tok }, urlAfter: `${B}billing.html` }); // 2
    t.add({ kind: "download", source: "url", url: `${B}inv-001.pdf`, path: "a.pdf" }); // 3
    for (let i = 0; i < TRACE_LIMIT - 2; i++) t.add({ kind: "navigate", url: `${B}p${i}.html` });
    assert.equal(t.list()[0]!.n, 2);
    assert.match(savePlaybookFromTrace(t.list(), [1, 3], undefined, "t").message, /no entry 1/);
    // Build with the evicted start replaced by a fresh one.
    const u = new PlaybookTrace();
    u.add({ kind: "navigate", url: `${B}home.html` });
    u.add({ kind: "click", locator: { role: "button", name: tok, text: tok }, urlAfter: `${B}billing.html` });
    u.add({ kind: "download", source: "url", url: `${B}inv-001.pdf`, path: "a.pdf" });
    savePlaybookFromTrace(u.list(), [1, 2, 3], undefined, "t");
    assert.deepEqual((getPlaybook("127.0.0.1")!.steps[0] as { target: object }).target, { role: "button" });
  });
});

describe("playbook_save with repeated rows and month selectors", () => {
  const SECRET = "Acme Corp INV-7731 jane@example.com";
  const texts = [`2026-09-03 49.00 EUR ${SECRET}`, `2026-10-03 49.00 EUR ${SECRET}`, `2026-10-20 12.00 EUR ${SECRET}`];
  const link = { role: "link", name: "Download invoice", text: "Download invoice" };
  const build = (clickedIndex: number, rowTexts: (string | null)[] = texts) => {
    const t = new PlaybookTrace();
    t.add({ kind: "navigate", url: `${B}months.html` }); // 1
    t.add({ kind: "click", locator: { role: "link", name: "October 2026", text: "October 2026" }, urlAfter: `${B}m-2026-10.html`, periodContext: { names: ["September 2026", "October 2026", "November 2026", null], clickedIndex: 1 } }); // 2
    t.add({ kind: "download", source: "ref", locator: link, contentType: "application/pdf", path: "a.pdf", rowContext: { texts: rowTexts, clickedIndex } }); // 3
    return t.list();
  };
  const save = (rows: ReturnType<typeof build>, invoice?: unknown) => savePlaybookFromTrace(rows, [1, 2, 3], undefined, "t", invoice);

  it("saves the row and the month as rules, with no row text and no invoice in the stored playbook", () => {
    const r = save(build(2), { date: "2026-10-20", amount: 12, currency: "eur" });
    assert.equal(r.event?.type, "playbook.event");
    const pb = getPlaybook("127.0.0.1")!;
    assert.deepEqual(pb.steps, [
      { kind: "click", target: { role: "link", period: true } },
      { kind: "download", target: { role: "link", name: "Download invoice", text: "Download invoice", row: { match: ["date"] } }, fileType: "pdf" },
    ]);
    const json = JSON.stringify(pb);
    for (const leak of ["Acme", "INV-7731", "jane@", "2026-10-20", "October"]) assert.ok(!json.includes(leak), leak);
  });

  it("adds the amount only when the date alone does not pick the row", () => {
    const same = [`2026-10-03 49.00 EUR`, `2026-10-03 12.00 EUR`];
    save(build(1, same), { date: "2026-10-03", amount: 12 });
    assert.deepEqual((getPlaybook("127.0.0.1")!.steps[1] as { target: { row: object } }).target.row, { match: ["amount", "date"] }); // stored sorted
  });

  it("refuses a step that picks a row when no invoice is given, or when the rule picks another row", () => {
    assert.match(save(build(2)).message, /pass the invoice it was for/);
    assert.match(save(build(1), { date: "2026-10-20" }).message, /not identify the row you clicked \(row 2 of 3\)/);
    assert.match(save(build(2, [texts[0]!, texts[1]!, null]), { date: "2026-10-20" }).message, /not identify/);
    assert.equal(getPlaybook("127.0.0.1"), null);
  });

  it("rejects malformed invoice parameters", () => {
    for (const bad of [{ date: "20/10/2026" }, { date: "2026-02-31" }, { date: "2026-10-20", amount: NaN }, { date: "2026-10-20", currency: "EURO" }, {}]) assert.match(save(build(2), bad).message, /^Not saved: invoice\./);
  });

  it("lists the place in the list, never the row text", () => {
    const text = describeTrace(build(2));
    assert.match(text, /^3 download link "Download invoice" \(row 3 of 3\) \(application\/pdf/m);
    assert.ok(!text.includes("Acme") && !text.includes("2026-10-20"));
  });

  it("saves nothing for an invoice whose date matches no row, even if the month click would stay literal", () => {
    assert.match(save(build(2), { date: "2026-12-20" }).message, /^Not saved/);
    assert.equal(getPlaybook("127.0.0.1"), null);
  });
});
