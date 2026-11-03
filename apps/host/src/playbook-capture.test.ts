import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { PlaybookTrace, TRACE_LIMIT, describeTrace, savePlaybookFromTrace } from "./playbook-capture.ts";
import { getPlaybook } from "./playbooks.ts";

const B = "http://127.0.0.1:8765/invoices/";
function trace(extra: Parameters<PlaybookTrace["add"]>[0][] = []) {
  const t = new PlaybookTrace();
  t.add({ kind: "navigate", url: `${B}login.html` }); // 1
  t.add({ kind: "navigate", url: `${B}home.html` }); // 2
  t.add({ kind: "click", locator: { role: "link", name: "Overview", text: "Overview" }, urlAfter: `${B}home.html` }); // 3 dead end
  t.add({ kind: "click", locator: { role: "link", name: "Billing", text: "Billing" }, urlAfter: `${B}billing.html` }); // 4
  t.add({ kind: "navigate", url: `${B}list.html` }); // 5
  t.add({ kind: "download", url: `${B}inv-001.pdf`, contentType: "application/pdf", path: "invoices/a.pdf" }); // 6
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
    assert.match(text, /^6 download .*inv-001\.pdf \(application\/pdf\)$/m);
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
    const rows = trace([{ kind: "download", url: "http://localhost:1/x.pdf", path: "x.pdf" }]).list(); // 7, other site
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
    assert.deepEqual(r.event, { type: "playbook.event", threadId: "t", kind: "updated", site: "127.0.0.1", step: 0 });
    const pb = getPlaybook("127.0.0.1")!;
    assert.equal(pb.steps.length, 2);
    assert.match(pb.history.at(-1)!.summary, /changed steps? 1,2/);
  });
});
