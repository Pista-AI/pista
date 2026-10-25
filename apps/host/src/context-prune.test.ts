import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defineTool, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fauxModels, setupHome } from "./test-helpers.ts";

const { root: tmp } = setupHome("context-prune-test", { cleanup: "exit" });
const { contextPruneExtension, contextPruneOptions, pruneToolResults } = await import("./context-prune.ts");
type PruneOptions = NonNullable<ReturnType<typeof contextPruneOptions>>;

type Part = { type: string; text?: string; data?: string; mimeType?: string };
type Msg = { role: string; toolName?: string; toolCallId?: string; isError?: boolean; content: Part[] | string };

const user = (text: string): Msg => ({ role: "user", content: text });
const assistant = (): Msg => ({ role: "assistant", content: [{ type: "text", text: "calling" }] });
const result = (toolName: string, text: string, extra: Part[] = []): Msg => ({
  role: "toolResult",
  toolName,
  content: [{ type: "text", text }, ...extra],
});
/** user, then `n` rounds of assistant + tool result, then a final assistant turn that read nothing yet. */
const thread = (...bodies: string[]): Msg[] => [user("go"), ...bodies.flatMap((b, i) => [assistant(), result(`tool${i}`, b)])];

const opts = (over: Partial<PruneOptions> = {}): PruneOptions => ({ keepRecent: 2, minChars: 100, maxToolChars: 1_000_000, batch: 1, protectedTools: [], ...over });
const textOf = (m: Msg) => (m.content as Part[]).map((p) => p.text ?? "").join("");
const isStub = (m: Msg) => textOf(m).startsWith("[Output pruned to save context:");

test("nothing is pruned under the thresholds", () => {
  const messages = [...thread("a".repeat(50), "b".repeat(50), "c".repeat(50), "d".repeat(50)), assistant()];
  assert.equal(pruneToolResults(messages, opts()), messages);
  // Big but recent.
  const recent = [...thread("x".repeat(5000), "y".repeat(5000)), assistant()];
  assert.equal(pruneToolResults(recent, opts()), recent);
});

test("oldest results are pruned first and recent ones kept; input is not mutated", () => {
  const bodies = ["one\ntwo\nthree".padEnd(500, "."), "b".repeat(500), "c".repeat(500), "d".repeat(500)];
  const messages = [...thread(...bodies), assistant()];
  const before = JSON.stringify(messages);
  const out = pruneToolResults(messages, opts());
  const results = out.filter((m) => m.role === "toolResult");
  assert.deepEqual(results.map(isStub), [true, true, false, false]);
  assert.equal(
    textOf(results[0]!),
    "[Output pruned to save context: tool0, 500 chars, 3 lines. Re-run the tool if you need it again.]",
  );
  assert.equal(textOf(results[3]!), bodies[3]);
  assert.equal(JSON.stringify(messages), before);
  assert.equal(out.length, messages.length);
});

test("tool results of the current turn are kept even when keepRecent is zero", () => {
  const messages = [...thread("a".repeat(500), "b".repeat(500)), assistant(), result("tool2", "c".repeat(500)), result("tool3", "d".repeat(500))];
  const out = pruneToolResults(messages, opts({ keepRecent: 0 }));
  assert.deepEqual(out.filter((m) => m.role === "toolResult").map(isStub), [true, true, false, false]);
});

test("the budget prunes older kept results oldest first and never the newest", () => {
  const messages = [...thread("a".repeat(400), "b".repeat(400), "c".repeat(400), "d".repeat(400))];
  // keepRecent covers all four, so only the budget can prune.
  const out = pruneToolResults(messages, opts({ keepRecent: 10, minChars: 100, maxToolChars: 1000 }));
  const flags = out.filter((m) => m.role === "toolResult").map(isStub);
  assert.deepEqual(flags, [true, true, false, false]);
  const total = out.filter((m) => m.role === "toolResult").reduce((n, m) => n + textOf(m).length, 0);
  assert.ok(total <= 1000, `total ${total}`);

  const tiny = pruneToolResults(messages, opts({ keepRecent: 10, maxToolChars: 10 }));
  assert.deepEqual(tiny.filter((m) => m.role === "toolResult").map(isStub), [true, true, true, false]);
});

test("pruning waits for a batch of stale results and then stubs them all together", () => {
  const batched = opts({ keepRecent: 4, batch: 4 });
  const bodies = (n: number) => Array.from({ length: n }, (_, i) => String(i).repeat(500));
  const flags = (n: number) =>
    pruneToolResults([...thread(...bodies(n)), assistant()], batched)
      .filter((m) => m.role === "toolResult")
      .map(isStub);
  assert.equal(flags(6).some(Boolean), false);
  assert.equal(flags(7).some(Boolean), false);
  assert.deepEqual(flags(8), [true, true, true, true, false, false, false, false]);
  // The next step adds one result; the four stubs from before are not a batch, so the prefix stays put.
  const first = pruneToolResults([...thread(...bodies(8)), assistant()], batched);
  const next = pruneToolResults([...first, result("tool8", "8".repeat(500)), assistant()], batched);
  assert.deepEqual(next.filter((m) => m.role === "toolResult").map(isStub), [true, true, true, true, false, false, false, false, false]);
});

test("a stub is only used when it is smaller than the result", () => {
  const messages = thread("tiny", "also tiny", "still tiny");
  const out = pruneToolResults(messages, opts({ keepRecent: 0, minChars: 0, maxToolChars: 0 }));
  assert.equal(out.filter((m) => m.role === "toolResult" && isStub(m)).length, 0);
});

test("image parts are dropped from pruned results and kept in recent ones", () => {
  const image: Part = { type: "image", data: "AAAA", mimeType: "image/png" };
  const messages: Msg[] = [
    user("go"),
    assistant(),
    result("image_view", "x".repeat(300), [image]),
    assistant(),
    result("read", "y", [image]),
    assistant(),
    result("read", "z", [image]),
    assistant(),
  ];
  const out = pruneToolResults(messages, opts({ keepRecent: 1 }));
  const first = out[2]!;
  assert.ok(isStub(first));
  assert.deepEqual((first.content as Part[]).map((p) => p.type), ["text"]);
  // Small text but an image: the image counts toward size, so it is pruned too when stale.
  assert.ok(isStub(out[4]!));
  assert.deepEqual((out[6]!.content as Part[]).map((p) => p.type), ["text", "image"]);
});

test("contextPruneOptions reads the env overrides and scales the budget with the window", () => {
  assert.equal(contextPruneOptions({ contextWindow: 18_000 }, { PISTA_CONTEXT_PRUNE: "off" }), undefined);
  assert.equal(contextPruneOptions({ contextWindow: 18_000 }, { PISTA_CONTEXT_PRUNE: " OFF " }), undefined);
  const dflt = contextPruneOptions({ contextWindow: 18_000 }, {})!;
  assert.deepEqual(dflt, { keepRecent: 4, minChars: 600, maxToolChars: 27_000, batch: 4, protectedTools: ["write", "edit"] });
  assert.equal(contextPruneOptions({ contextWindow: 1000 }, {})!.maxToolChars, 8_000);
  assert.equal(contextPruneOptions({ contextWindow: 200_000 }, {})!.maxToolChars, 300_000);
  assert.equal(contextPruneOptions({ contextWindow: 22_272 }, {})!.maxToolChars, 33_408);
  assert.equal(contextPruneOptions(undefined, {})!.maxToolChars, 49_152);
  assert.equal(contextPruneOptions({ contextWindow: 18_000 }, { PISTA_CONTEXT_PRUNE_KEEP: "7" })!.keepRecent, 7);
  assert.equal(contextPruneOptions({ contextWindow: 18_000 }, { PISTA_CONTEXT_PRUNE_KEEP: "0" })!.keepRecent, 0);
  assert.deepEqual(contextPruneOptions(undefined, { PISTA_CONTEXT_PRUNE_PROTECT: "read, bash ,," })!.protectedTools, ["read", "bash"]);
  assert.deepEqual(contextPruneOptions(undefined, { PISTA_CONTEXT_PRUNE_PROTECT: "" })!.protectedTools, []);
  for (const bad of ["", "abc", "-3", "NaN"]) {
    assert.equal(contextPruneOptions({ contextWindow: 18_000 }, { PISTA_CONTEXT_PRUNE_KEEP: bad })!.keepRecent, 4, bad);
  }
});

// -- integration: a real session; the model sees stubs, the session keeps full output ------------

test("the model is sent stubs for stale results while the session keeps the full output", async () => {
  const { ModelRuntime, SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { buildSession } = await import("./session.ts");
  const runtime = await ModelRuntime.create({ authPath: join(tmp, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const { piAi, faux, models, ref } = await fauxModels(runtime);

  const big = defineTool({
    name: "big",
    label: "Big",
    description: "Returns a large output.",
    parameters: Type.Object({ n: Type.Number() }),
    execute: async (_id, params) => ({ content: [{ type: "text" as const, text: `BIG-${params.n} ` + "z".repeat(2000) }], details: {} }),
  });
  const tool: InlineExtension = { name: "big-tool", factory: (pi) => pi.registerTool(big) };

  const seen: string[] = [];
  const calls = 9;
  const steps: unknown[] = Array.from({ length: calls }, (_, i) => piAi.fauxAssistantMessage(piAi.fauxToolCall("big", { n: i })));
  steps.push((context: { messages: Msg[] }) => {
    seen.push(...context.messages.filter((m) => m.role === "toolResult").map(textOf));
    return piAi.fauxAssistantMessage("done");
  });
  faux.setResponses(steps);

  const cwd = mkdtempSync(join(tmp, "ws-"));
  const session = await buildSession({
    cwd,
    models,
    model: ref,
    sessionManager: SessionManager.inMemory(cwd),
    appendSystemPrompt: [],
    extensionFactories: [tool, contextPruneExtension()],
  });
  await session.setModel(faux.getModel());
  await session.bindExtensions({});
  await session.prompt("go");

  assert.equal(seen.length, calls);
  assert.deepEqual(
    seen.map((t) => t.startsWith("[Output pruned")),
    [true, true, true, true, false, false, false, false, false],
  );
  const stored = (session.messages as Msg[]).filter((m) => m.role === "toolResult").map(textOf);
  assert.equal(stored.length, calls);
  stored.forEach((t, i) => assert.ok(t.startsWith(`BIG-${i} `) && t.length > 2000, `result ${i} kept in full`));
});

// -- dedup and protected tools -------------------------------------------------------------------

type Step = [id: string, tool: string, args: Record<string, unknown>, text: string];
/** user, then one assistant tool call plus its result per step, then a final assistant turn. */
const calls = (...steps: Step[]): Msg[] => [
  user("go"),
  ...steps.flatMap(([id, tool, args, text]) => [
    { role: "assistant", content: [{ type: "toolCall", id, name: tool, arguments: args } as unknown as Part] } as Msg,
    { role: "toolResult", toolCallId: id, toolName: tool, isError: false, content: [{ type: "text", text }] } as Msg,
  ]),
  assistant(),
];
const big = "x".repeat(300);

test("dedup keeps the newest of identical calls and stubs the older ones, whatever the key order", () => {
  const messages = calls(
    ["1", "read", { path: "a.ts", offset: 1 }, "OLD-" + big],
    ["2", "read", { path: "b.ts" }, "OTHER-" + big],
    ["3", "read", { offset: 1, path: "a.ts" }, "NEW-" + big],
    ["4", "read", { path: "a.ts", offset: 1 }, "NEWEST-" + big],
    ["5", "bash", {}, "last"],
  );
  const out = pruneToolResults(messages, opts({ keepRecent: 1, minChars: 100_000 }));
  const r = out.filter((m) => m.role === "toolResult");
  assert.equal(
    textOf(r[0]!),
    "[Duplicate output pruned: read was called again with the same arguments; see the later result.]",
  );
  assert.ok(textOf(r[1]!).startsWith("OTHER-"));
  assert.equal(textOf(r[2]!).startsWith("[Duplicate output pruned"), true);
  assert.ok(textOf(r[3]!).startsWith("NEWEST-"));
  assert.equal(out.length, messages.length);
});

test("different arguments or tools are not deduplicated", () => {
  const messages = calls(
    ["1", "read", { path: "a.ts" }, big],
    ["2", "read", { path: "b.ts" }, big],
    ["3", "grep", { path: "a.ts" }, big],
    ["4", "bash", {}, "last"],
  );
  assert.equal(pruneToolResults(messages, opts({ keepRecent: 10, minChars: 100_000 })), messages);
});

test("identical calls in the current turn are untouched, and a stub is never longer than the result", () => {
  const same = { path: "a.ts" };
  // Both results follow the assistant message that made the calls, so they belong to the current turn.
  const current: Msg[] = [
    user("go"),
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "1", name: "read", arguments: same },
        { type: "toolCall", id: "2", name: "read", arguments: same },
      ] as unknown as Part[],
    },
    { role: "toolResult", toolCallId: "1", toolName: "read", content: [{ type: "text", text: big }] },
    { role: "toolResult", toolCallId: "2", toolName: "read", content: [{ type: "text", text: big }] },
  ];
  assert.equal(pruneToolResults(current, opts({ keepRecent: 10 })), current);

  const tiny = calls(["1", "read", same, "ok"], ["2", "read", same, "ok"], ["3", "bash", {}, "last"]);
  assert.equal(pruneToolResults(tiny, opts({ keepRecent: 10 })), tiny);
});

test("a duplicate whose newer twin is itself stubbed becomes an ordinary stub", () => {
  const messages = calls(
    ["1", "read", { path: "a.ts" }, "A1-" + big],
    ["2", "read", { path: "a.ts" }, "A2-" + big],
    ["3", "bash", {}, "b".repeat(5000)],
    ["4", "bash", { n: 1 }, "last"],
  );
  // Budget so tight that the newer twin (A2) is stubbed as well.
  const out = pruneToolResults(messages, opts({ keepRecent: 10, minChars: 100_000, maxToolChars: 100 }));
  const r = out.filter((m) => m.role === "toolResult").map(textOf);
  assert.ok(r[0]!.startsWith("[Output pruned"), r[0]);
  assert.ok(r[1]!.startsWith("[Output pruned"), r[1]);
});

test("protected tools survive dedup and staleness", () => {
  const messages = calls(
    ["1", "write", { path: "a.ts" }, "W-" + "w".repeat(2000)],
    ["2", "write", { path: "a.ts" }, "W-" + "w".repeat(2000)],
    ["3", "edit", { path: "a.ts" }, "E-" + "e".repeat(2000)],
    ["4", "read", { path: "a.ts" }, "R-" + "r".repeat(2000)],
    ["5", "bash", {}, "last"],
  );
  const options = opts({ keepRecent: 0, minChars: 10, protectedTools: ["write", "edit"] });
  const r = pruneToolResults(messages, options).filter((m) => m.role === "toolResult");
  assert.deepEqual(r.map((m) => textOf(m).slice(0, 2)), ["W-", "W-", "E-", "[O", "la"]);
  // Without protection the same history is pruned.
  const open = pruneToolResults(messages, { ...options, protectedTools: [] }).filter((m) => m.role === "toolResult");
  assert.ok(open.slice(0, 4).every((m) => textOf(m).startsWith("[")));
});

test("protected results are stubbed only as a last resort when the budget cannot be met otherwise", () => {
  const messages = calls(
    ["1", "read", { path: "a.ts" }, "R1-" + "r".repeat(3000)],
    ["2", "bash", {}, "B-" + "b".repeat(500)],
    ["3", "read", { path: "b.ts" }, "R2-" + "r".repeat(3000)],
    ["4", "bash", { n: 1 }, "last"],
  );
  const flags = (maxToolChars: number) =>
    pruneToolResults(messages, opts({ keepRecent: 10, protectedTools: ["read"], maxToolChars }))
      .filter((m) => m.role === "toolResult")
      .map(isStub);
  assert.deepEqual(flags(1_000_000), [false, false, false, false]);
  // Dropping the unprotected bash result is enough: both reads survive.
  assert.deepEqual(flags(6_200), [false, true, false, false]);
  // Not enough: protected results go too, oldest first, never the newest.
  assert.deepEqual(flags(3_500), [true, true, false, false]);
  assert.deepEqual(flags(10), [true, true, true, false]);
});

test("a reused tool call id is paired with the nearest preceding call, and a name mismatch is not deduplicated", () => {
  const reused: Step[] = [
    ["call_1", "read", { path: "a.ts" }, "A-" + big],
    ["call_1", "read", { path: "b.ts" }, "B-" + big],
    ["x", "bash", {}, "last"],
  ];
  const messages = calls(...reused);
  assert.equal(pruneToolResults(messages, opts({ keepRecent: 0, minChars: 100_000 })), messages);
  // Same id and args, but the result belongs to another tool than the call named.
  const mismatch = calls(["1", "read", { path: "a.ts" }, "A-" + big], ["2", "read", { path: "a.ts" }, "B-" + big], ["3", "bash", {}, "last"]);
  (mismatch[2] as Msg).toolName = "grep";
  assert.equal(pruneToolResults(mismatch, opts({ keepRecent: 0, minChars: 100_000 })), mismatch);
});

test("arrays are order sensitive, and error results are never deduplicated", () => {
  const ordered = calls(["1", "read", { paths: ["a", "b"] }, big], ["2", "read", { paths: ["b", "a"] }, big], ["3", "bash", {}, "last"]);
  assert.equal(pruneToolResults(ordered, opts({ keepRecent: 0, minChars: 100_000 })), ordered);
  const failed = calls(["1", "read", { path: "a.ts" }, "ERR-" + big], ["2", "read", { path: "a.ts" }, big], ["3", "bash", {}, "last"]);
  (failed[2] as Msg).isError = true;
  assert.equal(pruneToolResults(failed, opts({ keepRecent: 0, minChars: 100_000 })), failed);
});

test("cyclic or BigInt arguments skip dedup for that call without disabling pruning", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const messages = calls(
    ["1", "read", cyclic, "C-" + big],
    ["2", "read", cyclic, "C-" + big],
    ["3", "read", { n: BigInt(1) }, "N-" + big],
    ["4", "read", { path: "old.ts" }, "OLD-" + big],
    ["5", "bash", {}, "last"],
  );
  const r = pruneToolResults(messages, opts({ keepRecent: 0 })).filter((m) => m.role === "toolResult").map(textOf);
  // Everything stale is still stubbed by the ordinary pass, none as a duplicate.
  assert.ok(r.slice(0, 4).every((t) => t.startsWith("[Output pruned")), r.join("|"));
});

test("a duplicate whose twin is pruned is left verbatim when the ordinary stub would be longer", () => {
  // Find a result length that beats the duplicate stub but not the (longer) ordinary stub.
  const dupLen = "[Duplicate output pruned: read was called again with the same arguments; see the later result.]".length;
  let body: string | undefined;
  for (let size = 80; size < 140 && !body; size++) {
    for (const lines of [1, 10, 100]) {
      if (lines > size) continue;
      const text = "\n".repeat(lines - 1).padEnd(size, "s");
      const ordinary = `[Output pruned to save context: read, ${size} chars, ${lines} lines. Re-run the tool if you need it again.]`.length;
      if (size > dupLen && size <= ordinary) body = text;
    }
  }
  assert.ok(body, "a length between the two stubs exists");
  const messages = calls(
    ["1", "read", { path: "a.ts" }, body],
    ["2", "read", { path: "a.ts" }, body],
    ["3", "bash", {}, "b".repeat(5000)],
    ["4", "bash", { n: 1 }, "last"],
  );
  const out = pruneToolResults(messages, opts({ keepRecent: 0, minChars: 100_000, maxToolChars: 100 }));
  const r = out.filter((m) => m.role === "toolResult").map(textOf);
  assert.equal(r[0], body);
  assert.equal(r[1], body);
});

test("dedup respects keepRecent and waits for the batch boundary", () => {
  const same = { path: "a.ts" };
  const steps = (n: number): Step[] => [
    ...Array.from({ length: n }, (_, i): Step => [`${i}`, "read", i < n - 1 ? same : { path: "z" }, `R${i}-` + big]),
    ["last", "bash", {}, "last"],
  ];
  const options = opts({ keepRecent: 4, batch: 4 });
  const flags = (n: number) =>
    pruneToolResults(calls(...steps(n)), options).filter((m) => m.role === "toolResult").map((m) => textOf(m).startsWith("["));
  // 9 results, 5 outside the newest 4, boundary at 4: only the first four are stubbed, together.
  assert.deepEqual(flags(8), [true, true, true, true, false, false, false, false, false]);
  // One more result does not move the boundary: the prefix is the same.
  assert.deepEqual(flags(9).slice(0, 4), [true, true, true, true]);
  assert.equal(flags(9).filter(Boolean).length, 4);
  // Duplicates inside the newest 4 are untouched.
  assert.equal(flags(4).some(Boolean), false);
});

test("browser page views are left to pi-browser: never stubbed, not even over budget", () => {
  const messages: Msg[] = [user("go")];
  for (const tool of ["browser_snapshot", "browser_read", "browser_click", "tool0", "tool1", "tool2"]) messages.push(assistant(), result(tool, "p".repeat(900)));
  messages.push(assistant());
  const out = pruneToolResults(messages, opts({ keepRecent: 0, minChars: 0, maxToolChars: 0 }));
  for (const i of [2, 4, 6]) assert.equal(out[i], messages[i], `${messages[i]!.toolName} untouched`);
  for (const i of [8, 10]) assert.ok(isStub(out[i]!), `${messages[i]!.toolName} still pruned`);
});
