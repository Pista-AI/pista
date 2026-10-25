import assert from "node:assert/strict";
import { test } from "node:test";
import { collapsePageViews, DEFAULT_STALE_DOCUMENT_TURNS, type CollapseState } from "../src/collapse.ts";
import { createPageViewCompactor } from "../src/context.ts";
import { presentSnapshot } from "../src/delta.ts";
import type { BrowserDriver } from "../src/driver.ts";
import type { PageSnapshot } from "../src/page-scripts.ts";

const fresh = (): CollapseState => ({ collapsed: new Set() });
const user = { role: "user", content: [{ type: "text", text: "go" }] };
const assistant = (...calls: { id: string; name: string; arguments: object }[]) => ({
  role: "assistant",
  content: [{ type: "text", text: "ok" }, ...calls.map((c) => ({ type: "toolCall", ...c }))],
});
const call = (id: string, name: string, args: object = {}) => ({ id, name, arguments: args });
const meta = (url: string, title = "Page") => JSON.stringify({ url, title }, null, 2);

const snap = (id: string, url: string, lines: string[] = [], title = "Page") => ({
  role: "toolResult",
  toolName: "browser_snapshot",
  toolCallId: id,
  isError: false,
  content: [
    { type: "text", text: meta(url, title) },
    { type: "text", text: [`${lines.length} interactive elements. Whole page fits in the viewport.`, "", ...lines].join("\n") },
  ],
});
const delta = (id: string, url: string, tool = "browser_click") => ({
  role: "toolResult",
  toolName: tool,
  toolCallId: id,
  isError: false,
  content: [
    { type: "text", text: meta(url) },
    { type: "text", text: "Page changed (delta since last view):\n+ [e99] button \"New\"" },
  ],
});
const nav = (id: string, url: string) => ({
  role: "toolResult",
  toolName: "browser_navigate",
  toolCallId: id,
  isError: false,
  content: [{ type: "text", text: meta(url) }],
});
const text = (m: unknown) => (m as { content: { text?: string }[] }).content.map((p) => p.text ?? "").join("\n");
const collapsedLine = (m: unknown) => text(m).startsWith("[earlier");
const A = "https://shop.test/a";
const B = "https://shop.test/b";
const LINES = ['[e12] button "Contact"', '[e20] textbox "Name"'];

test("the latest view of the current document stays full; older views of it collapse to one line", () => {
  const msgs = [user, assistant(call("c1", "browser_snapshot")), snap("c1", A, LINES, "Shop home"), assistant(call("c2", "browser_snapshot")), snap("c2", A, LINES, "Shop home")];
  const out = collapsePageViews(msgs, fresh()).messages;
  assert.deepEqual((out[2] as { content: unknown[] }).content.length, 1);
  assert.equal(text(out[2]), "[earlier view of shop.test/a: Shop home, 2 elements]");
  assert.equal(out[4], msgs[4], "newest is the same object");
});

test("acted-on list: click names come from the element line, fill runs collapse", () => {
  const msgs = [
    user,
    snap("c1", A, LINES),
    assistant(call("c2", "browser_click", { ref: "e12" }), call("c3", "browser_fill", { fields: [20, 21, 22, 23, 24].map((n) => ({ ref: `e${n}`, value: "x" })) }), call("c4", "browser_click", { ref: "e77" })),
    snap("c2", A, LINES),
    snap("c5", A, LINES),
  ];
  const line = text(collapsePageViews(msgs, fresh()).messages[1]);
  assert.equal(line, '[earlier view of shop.test/a: Page, 2 elements; acted on: e12 (click "Contact"), e20..e24 (fill), e77 (click)]');
});

test("a long acted-on list is cut with an ellipsis and the line stays short", () => {
  const fields = Array.from({ length: 60 }, (_, i) => ({ ref: `e${i * 2}`, value: "x" }));
  const msgs = [user, snap("c1", A), assistant(call("c2", "browser_fill", { fields })), snap("c2", A), snap("c3", A)];
  const line = text(collapsePageViews(msgs, fresh()).messages[1]);
  assert.ok(line.length <= 300, `${line.length}`);
  assert.ok(line.endsWith(", …]"));
});

test("a newest delta keeps its full baseline (and deltas in between) in full", () => {
  const msgs = [user, snap("c1", A, LINES), delta("c2", A), delta("c3", A), snap("c0", B), snap("c9", A)];
  // Newest is a full view: everything earlier on A collapses.
  assert.deepEqual(collapsePageViews(msgs, fresh()).messages.map(collapsedLine), [false, true, true, true, false, false]); // B was just left, so its latest view is still fresh
  const withDelta = [user, snap("c1", A, LINES), snap("c4", A, LINES), delta("c2", A), delta("c3", A)];
  const out = collapsePageViews(withDelta, fresh());
  assert.deepEqual(out.messages.map(collapsedLine), [false, true, false, false, false]);
  assert.ok(out.newestChain.has("c4") && out.newestChain.has("c2") && out.newestChain.has("c3") && !out.newestChain.has("c1"));
});

test("a document collapses entirely once the model left it more than staleDocumentTurns assistant turns ago", () => {
  const base = [user, snap("c1", A), nav("n1", B), snap("c2", B)];
  const turn = (i: number) => [assistant(call(`t${i}`, "browser_snapshot")), snap(`t${i}`, B)];
  // Left A at the navigate (index 2). Assistant turns after it: none yet, then 1, 2, 3.
  const after = (n: number) => [...base, ...Array.from({ length: n }, (_, i) => turn(i)).flat()];
  const a = (n: number) => collapsedLine(collapsePageViews(after(n), fresh(), { staleDocumentTurns: 2 }).messages[1]);
  assert.equal(a(0), false);
  assert.equal(a(1), false);
  assert.equal(a(2), false);
  assert.equal(a(3), true);
  // A larger allowance keeps it.
  assert.equal(collapsePageViews(after(3), fresh(), { staleDocumentTurns: 5 }).messages.map(collapsedLine)[1], false);
});

test("the default stale-document grace is one assistant turn", () => {
  assert.equal(DEFAULT_STALE_DOCUMENT_TURNS, 1);
});

test("PI_BROWSER_STALE_DOC_TURNS sets the default", () => {
  const msgs = [user, snap("c1", A), nav("n1", B), snap("c2", B), assistant(), snap("c3", B)];
  process.env.PI_BROWSER_STALE_DOC_TURNS = "0";
  try {
    assert.equal(collapsedLine(collapsePageViews(msgs, fresh()).messages[1]), true);
  } finally {
    delete process.env.PI_BROWSER_STALE_DOC_TURNS;
  }
  assert.equal(collapsedLine(collapsePageViews(msgs, fresh()).messages[1]), false);
});

test("collapsing is sticky across calls even when the rules would now keep the view", () => {
  const state = fresh();
  const msgs = [user, snap("c1", A), snap("c2", A)];
  assert.equal(collapsedLine(collapsePageViews(msgs, state).messages[1]), true);
  // A history where c1 would be the latest of A again (c2 gone): it must still be collapsed.
  const out = collapsePageViews([user, snap("c1", A)], state);
  assert.equal(collapsedLine(out.messages[1]), true);
  assert.deepEqual(out.newlyCollapsed, []);
  // And the earlier prefix is identical on a later request.
  const next = collapsePageViews([...msgs, snap("c3", A)], state).messages;
  assert.deepEqual(next.slice(0, 2), collapsePageViews(msgs, fresh()).messages.slice(0, 2));
});

test("a failed result collapses to a failure line, but stays in full while it is the newest", () => {
  const failed = (id: string) => ({ role: "toolResult", toolName: "browser_click", toolCallId: id, isError: true, content: [{ type: "text", text: meta(A) }, { type: "text", text: "Ref e5 is not on the page" }] });
  const msgs = [user, snap("c1", A), failed("f1")];
  assert.ok(!collapsedLine(collapsePageViews(msgs, fresh()).messages[2]), "newest error kept");
  const out = collapsePageViews([...msgs, snap("c2", A)], fresh()).messages;
  assert.equal(text(out[2]), "[earlier failed browser_click on shop.test/a]");
});

test("results without a tool-call id are never collapsed", () => {
  const noId = (m: object) => ({ ...m, toolCallId: undefined });
  const msgs = [user, noId(snap("c1", A)), noId(snap("c2", A)), snap("c3", A)];
  assert.deepEqual(collapsePageViews(msgs, fresh()).messages.map(collapsedLine), [false, false, false, false]);
});

test("browser_navigate results are never collapsed, and set the current document", () => {
  const msgs = [user, snap("c1", A), nav("n1", B), snap("c2", A), nav("n2", B)];
  const out = collapsePageViews(msgs, fresh()).messages;
  assert.equal(out[2], msgs[2]);
  assert.equal(out[4], msgs[4]);
});

test("the read view says text view; element counts are omitted for deltas", () => {
  const read = { role: "toolResult", toolName: "browser_read", toolCallId: "r1", isError: false, content: [{ type: "text", text: meta(`${A}?q=1#top`, "T".repeat(80)) }, { type: "text", text: "plain text" }] };
  const line = text(collapsePageViews([user, read, snap("c2", `${A}?q=1`)], fresh()).messages[1]);
  assert.equal(line, `[earlier view of shop.test/a: ${"T".repeat(59)}…, text view]`);
});

test("stage 2 still runs after stage 1: over budget, the kept views beyond `keep` are stubbed", () => {
  const big = (id: string, url: string) => ({ ...snap(id, url, Array.from({ length: 400 }, (_, i) => `[e${i}] button "Item ${i}"`)) });
  const msgs = [user, big("c1", A), big("c2", B), big("c3", "https://shop.test/c")];
  // Three documents, all fresh: stage 1 keeps all three. A tiny budget forces stage 2.
  const out = createPageViewCompactor(() => 100)(msgs);
  assert.deepEqual(out.map((m) => JSON.stringify(m).includes("removed from the context")), [false, true, true, false]);
  assert.deepEqual(createPageViewCompactor(() => 1_000_000)(msgs).map(collapsedLine), [false, false, false, false]);
});

const viewOf = (tool: string, id: string, url: string) => ({
  role: "toolResult",
  toolName: tool,
  toolCallId: id,
  isError: false,
  content: [{ type: "text", text: meta(url) }, { type: "text", text: "body text" }],
});

for (const tool of ["browser_read", "browser_screenshot"]) {
  test(`a snapshot stays full while a ${tool} of the same document is the newest view`, () => {
    const out = collapsePageViews([user, snap("c1", A, LINES), viewOf(tool, "r1", A)], fresh());
    assert.deepEqual(out.messages.map(collapsedLine), [false, false, false]);
    assert.ok(out.newestChain.has("c1") && out.newestChain.has("r1"));
    // A read of another document does not pin the snapshot.
    assert.equal(collapsedLine(collapsePageViews([user, snap("c1", A, LINES), viewOf(tool, "r1", B)], fresh()).messages[1]), false, "A was just left, still fresh");
    assert.equal(collapsePageViews([user, snap("c1", A, LINES), viewOf(tool, "r1", B)], fresh()).newestChain.has("c1"), false);
  });
}

test("stage 2 stubbing the snapshot behind a newest read invalidates the delta baseline, so the next action result is a full snapshot", () => {
  const driver = {} as BrowserDriver;
  const lines = Array.from({ length: 20 }, (_, i) => `[e${i + 1}] link "L${i + 1}"`);
  const page = (l: string[]): PageSnapshot => ({ lines: l, count: l.length, omitted: 0, scroll: { y: 0, height: 10, viewport: 10 }, elements: [], doc: "d1", href: A });
  const changed = [...lines.slice(0, 19), '[e20] link "changed"'];
  presentSnapshot(driver, page(lines), true);
  assert.match(presentSnapshot(driver, page(changed), true), /^Page changed/, "sanity: a delta is possible");

  const big = snap("c1", A, Array.from({ length: 400 }, (_, i) => `[e${i} ] button "Item ${i}"`));
  const msgs = [user, big, viewOf("browser_read", "r1", A)];
  presentSnapshot(driver, page(lines), true);
  createPageViewCompactor(() => 100)(msgs); // over budget: stubs everything but the newest view, including the snapshot
  assert.match(presentSnapshot(driver, page(changed), true), /^20 interactive elements/, "baseline was invalidated");

  // Under budget nothing is stubbed and the baseline survives.
  presentSnapshot(driver, page(lines), true);
  createPageViewCompactor(() => 1_000_000)(msgs);
  assert.match(presentSnapshot(driver, page(changed), true), /^Page changed/);
});

test("a view the budget stage stubbed while fresh is not rewritten to the collapse line when its document goes stale", () => {
  const compact = createPageViewCompactor(() => 100, 1, () => 0, { staleDocumentTurns: 0 });
  const first = [user, snap("c1", A, LINES), snap("c2", B, LINES)];
  assert.ok(JSON.stringify(compact(first)[1]).includes("removed from the context"));
  const later = [...first, assistant(), snap("c3", B, LINES), assistant(), snap("c4", B, LINES)];
  assert.ok(JSON.stringify(compact(later)[1]).includes("removed from the context"), "still the stub");
  assert.ok(!collapsedLine(compact(later)[1]));
});

test("parseStaleDocumentTurns accepts whole numbers >= 0 and rejects the rest", async () => {
  const { parseStaleDocumentTurns } = await import("../src/collapse.ts");
  assert.equal(parseStaleDocumentTurns("0"), 0);
  assert.equal(parseStaleDocumentTurns("3"), 3);
  for (const bad of [undefined, "", " ", "abc", "-1", "1.5"]) assert.equal(parseStaleDocumentTurns(bad), undefined);
});

test("applyCollapse never rewrites protected indexes, even when the id was collapsed earlier (reused ids)", async () => {
  const { applyCollapse } = await import("../src/collapse.ts");
  const view = (id: string, text: string) => ({ role: "toolResult", toolName: "browser_snapshot", toolCallId: id, isError: false, content: [{ type: "text", text: '{"url":"https://a.com/","title":"A"}' }, { type: "text", text }] });
  const msgs = [view("0", "3 interactive elements\n[e1] button \"x\""), view("0", "4 interactive elements\n[e1] button \"y\"")];
  const out = applyCollapse(msgs, new Set(["0"]), new Set([1]));
  assert.ok((out[0] as any).content[0].text.startsWith("[earlier "));
  assert.equal(out[1], msgs[1]);
});
