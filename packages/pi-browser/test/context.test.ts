import assert from "node:assert/strict";
import { test } from "node:test";
import { createPageViewCompactor, DEFAULT_OVERHEAD_TOKENS, estimatePromptTokens, estimateTokens, prunePageViews, resolveCompactBudget } from "../src/context.ts";

const view = (n: number, chars = 2000) => ({
  role: "toolResult",
  toolName: "browser_read",
  toolCallId: `call-${n}`,
  content: [
    { type: "text", text: `{"url":"https://example.test/${n}"}` },
    { type: "text", text: `page ${n} `.repeat(chars / 8) },
  ],
});
const user = { role: "user", content: [{ type: "text", text: "go" }] };
const isStub = (m: unknown) => JSON.stringify(m).includes("removed from the context");

/** Messages as the request at step `n` would see them: the user turn plus n page views. */
const history = (n: number) => [user, ...Array.from({ length: n }, (_, i) => view(i + 1))];

test("below the budget, consecutive requests share an identical prefix and nothing is stubbed", () => {
  const compact = createPageViewCompactor(() => 100_000);
  let prev = compact(history(1));
  for (let n = 2; n <= 8; n++) {
    const next = compact(history(n));
    assert.deepEqual(next.slice(0, prev.length), prev);
    assert.ok(!next.some(isStub));
    prev = next;
  }
});

test("above the budget, old views are stubbed once and stay stubbed, so later prefixes are stable", () => {
  // Each view is ~500 tokens, so a 2000-token budget is crossed at the fifth view.
  const compact = createPageViewCompactor(() => 2000);
  let n = 1;
  while (estimateTokens(history(n)) <= 2000) assert.ok(!compact(history(n++)).some(isStub));

  const compacted = compact(history(n));
  assert.equal(compacted.filter(isStub).length, n - 1, "all old views stubbed at once");
  assert.ok((compacted.find(isStub) as { content: unknown[] }).content.length === 2, "stub keeps the header part");

  // The following step appends one view and, being under the budget again, stubs nothing new except the
  // previous latest if it also trips the budget; either way the already-compacted prefix must not change.
  let prev = compacted;
  for (let k = n + 1; k <= n + 4; k++) {
    const next = compact(history(k));
    assert.deepEqual(next.slice(0, n), prev.slice(0, n), "previously compacted prefix is byte-identical");
    prev = next;
  }
});

test("a stubbed view stays stubbed even when a later request is under the budget", () => {
  const compact = createPageViewCompactor(() => 2000);
  compact(history(6));
  const out = compact(history(2));
  assert.ok(isStub(out[1]));
  assert.ok(!isStub(out[2]));
});

test("the latest page view is never stubbed", () => {
  const compact = createPageViewCompactor(() => 1);
  for (let n = 1; n <= 4; n++) {
    const out = compact(history(n));
    assert.ok(!isStub(out[out.length - 1]));
    assert.equal(out.filter(isStub).length, n - 1);
  }
});

test("a page view without a tool-call id is never stubbed", () => {
  const noId = (n: number) => ({ ...view(n), toolCallId: undefined });
  const compact = createPageViewCompactor(() => 1);
  const messages = [user, noId(1), noId(2), view(3)];
  assert.ok(!compact(messages).some(isStub));
});

test("prunePageViews without a filter stubs everything but the latest", () => {
  assert.deepEqual(prunePageViews(history(3)).map(isStub), [false, true, true, false]);
});

test("resolveCompactBudget: default, fraction, absolute tokens", () => {
  assert.equal(resolveCompactBudget(undefined, 10000), 6500);
  assert.equal(resolveCompactBudget(undefined), 0.65 * 32768);
  assert.equal(resolveCompactBudget("0.5", 10000), 5000);
  assert.equal(resolveCompactBudget("12000", 10000), 12000);
  assert.equal(resolveCompactBudget("junk", 10000), 6500);
});

const text = (chars: number) => ({ role: "user", content: [{ type: "text", text: "x".repeat(chars) }] });
const reply = (input: number, output = 100, extra: object = {}) => ({
  role: "assistant",
  content: [{ type: "text", text: "ok" }],
  stopReason: "toolUse",
  usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output },
  ...extra,
});

test("a recorded-like history (about 60k chars) plus overhead estimates above 65% of a 32k window", () => {
  const messages = [user, ...Array.from({ length: 6 }, (_, i) => view(i + 1, 12_000))];
  const chars = JSON.stringify(messages.map((m) => m.content)).length;
  assert.ok(chars > 60_000);
  assert.ok(estimatePromptTokens(messages) > 0.65 * 32768, `${estimatePromptTokens(messages)}`);
  assert.equal(estimatePromptTokens(messages), estimateTokens(messages) + DEFAULT_OVERHEAD_TOKENS);
});

test("real usage from the previous reply is used, plus an estimate of what was appended since", () => {
  const messages = [text(400_000), reply(20_000, 300), text(2500)];
  assert.equal(estimatePromptTokens(messages), 20_300 + 1000);
  // Cache reads and writes are prompt tokens too; errored replies are skipped.
  const cached = [reply(1000, 0, { usage: { input: 1000, output: 0, cacheRead: 5000, cacheWrite: 500 } })];
  assert.equal(estimatePromptTokens(cached), 6500);
  assert.equal(estimatePromptTokens([text(250), reply(9000, 10, { stopReason: "error" })]), 101 + DEFAULT_OVERHEAD_TOKENS);
});

test("the compactor fires on real usage even when the character estimate stays low", () => {
  const compact = createPageViewCompactor(() => 21_299);
  const messages = [user, view(1), view(2), reply(25_000), view(3)];
  const out = compact(messages);
  assert.deepEqual(out.map(isStub), [false, true, true, false, false]);
});

test("after stubbing, real usage of the earlier (larger) request is corrected, so the next step does not re-stub", () => {
  const compact = createPageViewCompactor(() => 21_299);
  const big = [user, view(1, 20_000), view(2, 20_000), view(3, 20_000), reply(24_000)];
  assert.ok(compact(big).filter(isStub).length === 2);
  // Next request: the reply's usage reflects the stubbed prompt (about 4k tokens) and one view is appended.
  const next = [...big.slice(0, 4), reply(4_000), view(4, 20_000)];
  const out = compact([...big.slice(0, 4), reply(4_000), view(4, 20_000)]);
  assert.ok(isStub(out[1]) && isStub(out[2]));
  assert.ok(!isStub(out[3]), "view 3 was kept as the latest in the sent request and is not stubbed by a low real count");
  assert.ok(next.length === out.length);
});

test("the compactor adds the configured overhead to the character estimate", () => {
  const messages = [user, view(1, 20_000)];
  assert.ok(!createPageViewCompactor(() => 9_000)([user, view(1), view(2, 100)]).some(isStub));
  assert.ok(createPageViewCompactor(() => 9_000, 1, () => 5_000)([user, view(1, 20_000), view(2, 100)]).some(isStub));
  assert.ok(messages.length === 2);
});
