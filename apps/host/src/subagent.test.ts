import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxModels, liveOf as liveMap, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("agent-tool");
const { createAgentRunner, MAX_RUNNING_CHILDREN } = await import("./subagent.ts");

const { piAi, faux, models, ref } = await fauxModels();
const { manager, store, project } = await makeManager({ projectDir, models });
store.patchConfig({ defaultModel: ref });

type Manager = typeof manager;
type Live = { session: { isStreaming: boolean; messages: unknown[]; getAllTools(): { name: string }[] } };
const liveOf = () => liveMap<Live>(manager);

/** A scripted model reply that waits for `release()` (or for the run to be aborted). */
function gated(reply: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const step = async (_ctx: unknown, options?: { signal?: AbortSignal }) => {
    await Promise.race([gate, new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }))]);
    return piAi.fauxAssistantMessage(reply);
  };
  return { step, release };
}

const waitFor = async (condition: () => boolean, what: string) => {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(condition(), `timed out waiting for ${what}`);
};

async function newParent(m: Manager = manager) {
  const { summary } = await m.create(project.id);
  return summary.id;
}

const brief = "Find the entry point. Report the file path only.";

test("the parent receives only the child's final message, plus a footer with the thread id", async () => {
  const parentId = await newParent();
  faux.setResponses([piAi.fauxAssistantMessage("FINAL-ANSWER: src/index.ts")]);
  const updates: { childThreadId?: string }[] = [];
  const run = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId } });

  const result = await run({ role: "explorer", goal: brief }, undefined, (u) => updates.push(u.details));

  const out = result.content[0]!.text;
  assert.ok(out.startsWith("FINAL-ANSWER: src/index.ts"));
  assert.ok(!out.includes(brief), "the brief is not echoed back");
  assert.equal(result.details.role, "explorer");
  const childId = result.details.childThreadId!;
  assert.ok(out.includes(childId), "footer names the child thread");
  assert.equal(updates[0]?.childThreadId, childId, "the child id is surfaced before the run finishes");

  const child = (await manager.list()).find((t) => t.id === childId);
  assert.equal(child?.parentId, parentId);
  assert.equal(child?.status, "idle");
  assert.equal(liveOf().get(parentId)!.session.messages.length, 0, "nothing from the child leaks into the parent's transcript");
});

test("a dispatch and its completion are recorded as agent_dispatch and agent_result", async () => {
  const parentId = await newParent();
  faux.setResponses([piAi.fauxAssistantMessage("FINAL-ANSWER: src/index.ts")]);
  const decisions: { kind: string; summary: string; reason?: string; evidence?: string; data?: Record<string, unknown> }[] = [];
  const run = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId }, record: (d) => void decisions.push(d) });
  const result = await run({ role: "explorer", goal: brief, reason: "keep exploration out of my context" });
  const childId = result.details.childThreadId!;
  assert.deepEqual(decisions.map((d) => d.kind), ["agent_dispatch", "agent_result"]);
  assert.equal(decisions[0]!.summary, `Dispatch explorer: ${brief}`);
  assert.equal(decisions[0]!.reason, "keep exploration out of my context");
  assert.deepEqual(decisions[0]!.data, { role: "explorer", childThreadId: childId, continueId: null });
  assert.match(decisions[1]!.summary, /^explorer done: \d+ tool calls, \d+ tokens$/);
  assert.equal(decisions[1]!.evidence, "FINAL-ANSWER: src/index.ts");
  assert.equal(decisions[1]!.data?.outcome, "done");
  assert.equal(decisions[1]!.data?.childThreadId, childId);
});

test("a timeout is recorded as an agent_result with outcome timeout", async () => {
  const parentId = await newParent();
  const decisions: { kind: string; summary: string; data?: Record<string, unknown> }[] = [];
  const run = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId }, timeoutMs: 30, record: (d) => void decisions.push(d) });
  const stuck = gated("never");
  faux.setResponses([stuck.step]);
  await assert.rejects(run({ role: "explorer", goal: brief }), /did not finish in time/);
  stuck.release();
  assert.equal(decisions.at(-1)?.summary, "explorer timeout");
  assert.equal(decisions.at(-1)?.data?.outcome, "timeout");
});

test("continueId sends a follow-up to the same child; non-children are rejected", async () => {
  const parentId = await newParent();
  const run = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId } });
  faux.setResponses([piAi.fauxAssistantMessage("first report"), piAi.fauxAssistantMessage("second report")]);
  const first = await run({ role: "reviewer", goal: brief });
  const childId = first.details.childThreadId!;

  const second = await run({ role: "reviewer", goal: "And the tests?", continueId: childId });
  assert.equal(second.details.childThreadId, childId);
  assert.ok(second.content[0]!.text.startsWith("second report"));
  assert.ok(!/thread total/.test(first.content[0]!.text), "a fresh child reports plain tokens");
  assert.match(second.content[0]!.text, /thread total \d+ tokens\]$/);

  const otherParent = await newParent();
  faux.setResponses([piAi.fauxAssistantMessage("other report")]);
  const otherChild = (await createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: otherParent } })({ role: "explorer", goal: brief }, undefined, undefined)).details.childThreadId!;
  faux.setResponses([piAi.fauxAssistantMessage("never used")]);
  for (const continueId of [parentId, otherChild, "no-such-thread"]) {
    await assert.rejects(run({ role: "explorer", goal: brief, continueId }), /not a sub-agent thread of this thread/, continueId);
  }
});

test("a child that produces no final message is an error", async () => {
  const parentId = await newParent();
  faux.setResponses([piAi.fauxAssistantMessage("   ")]);
  await assert.rejects(createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId } })({ role: "explorer", goal: brief }), /no final message/);
});

test("a 4th concurrent call is rejected immediately; the first three finish normally", async () => {
  const parentId = await newParent();
  const run = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId } });
  const steps = Array.from({ length: MAX_RUNNING_CHILDREN }, (_, i) => gated(`report ${i}`));
  faux.setResponses(steps.map((s) => s.step));

  const calls = steps.map((_, i) => run({ role: "explorer", goal: `task ${i}` }));
  await waitFor(() => faux.state.callCount >= MAX_RUNNING_CHILDREN, "three children to be running");
  await assert.rejects(run({ role: "explorer", goal: "one too many" }), /Too many sub-agents/);

  steps.forEach((s) => s.release());
  const results = await Promise.all(calls);
  assert.equal(results.length, MAX_RUNNING_CHILDREN);
  for (const r of results) assert.ok(/^report \d/.test(r.content[0]!.text));

  // The slots are free again.
  faux.setResponses([piAi.fauxAssistantMessage("after")]);
  assert.ok((await run({ role: "explorer", goal: brief })).content[0]!.text.startsWith("after"));
});

test("an implementer dispatched while an explorer runs records a warning and gets a note; sequential dispatch does not", async () => {
  const parentId = await newParent();
  const decisions: { kind: string; summary: string; data?: Record<string, unknown> }[] = [];
  const prompts: string[] = [];
  const threads = {
    spawnChild: (...a: Parameters<Manager["spawnChild"]>) => manager.spawnChild(...a),
    continueChild: (id: string) => manager.continueChild(id),
    abort: (id: string) => manager.abort(id),
    startPrompt: (id: string, text: string, ...rest: unknown[]) => {
      prompts.push(text);
      return (manager.startPrompt as (...a: unknown[]) => ReturnType<Manager["startPrompt"]>)(id, text, ...rest);
    },
  };
  const run = createAgentRunner({ reportFormat: false, threads, ref: { threadId: parentId }, record: (d) => void decisions.push(d) });
  const warnings = () => decisions.filter((d) => d.summary === "Warning: implementer dispatched while explorer still running");

  // Sequential: the explorer is done before the implementer starts.
  faux.setResponses([piAi.fauxAssistantMessage("explored"), piAi.fauxAssistantMessage("implemented")]);
  await run({ role: "explorer", goal: brief });
  await run({ role: "implementer", goal: "Edit src/a.ts", acceptance: "pnpm test" });
  assert.equal(warnings().length, 0);
  assert.ok(prompts.every((p) => !p.includes("explorer is still running")));

  // Same turn: both calls start before either finishes.
  const slow = gated("explored late");
  faux.setResponses([slow.step, piAi.fauxAssistantMessage("implemented early")]);
  const explorer = run({ role: "explorer", goal: brief });
  const implementer = run({ role: "implementer", goal: "Edit src/b.ts", acceptance: "pnpm test" });
  const implemented = await implementer;
  slow.release();
  await explorer;
  assert.ok(implemented.content[0]!.text.startsWith("implemented early"));
  assert.equal(warnings().length, 1);
  assert.equal(warnings()[0]!.data?.implementerChildThreadId, implemented.details.childThreadId);
  assert.ok(prompts.some((p) => p.includes("Edit src/b.ts") && p.includes("an explorer is still running; do not repeat its exploration")));
});

test("aborting the parent's signal aborts the child and returns an aborted result", async () => {
  const parentId = await newParent();
  const aborted: string[] = [];
  const threads = {
    spawnChild: (...a: Parameters<Manager["spawnChild"]>) => manager.spawnChild(...a),
    startPrompt: (...a: Parameters<Manager["startPrompt"]>) => manager.startPrompt(...a),
    continueChild: (id: string) => manager.continueChild(id),
    abort: async (id: string) => {
      aborted.push(id);
      await manager.abort(id);
    },
  };
  const run = createAgentRunner({ reportFormat: false, threads, ref: { threadId: parentId } });
  const slow = gated("too late");
  faux.setResponses([slow.step]);

  const controller = new AbortController();
  const call = run({ role: "implementer", goal: brief, acceptance: "pnpm test" }, controller.signal);
  await waitFor(() => faux.state.callCount > 0 && liveOf().size > 0 && [...liveOf().values()].some((t) => t.session.isStreaming), "the child to be streaming");
  controller.abort();
  const result = await call;

  assert.equal(result.details.aborted, true);
  assert.equal(aborted.length, 1);
  assert.equal(aborted[0], result.details.childThreadId);
  assert.match(result.content[0]!.text, /^Aborted/);
  slow.release();

  // A signal that is already aborted never starts a child.
  const before = (await manager.list()).length;
  const done = await run({ role: "explorer", goal: brief }, AbortSignal.abort());
  assert.equal(done.details.aborted, true);
  assert.equal((await manager.list()).length, before, "no child was spawned");
});

test("a child that never settles is stopped after the timeout", async () => {
  const parentId = await newParent();
  const run = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId }, timeoutMs: 50 });
  const stuck = gated("never");
  faux.setResponses([stuck.step]);
  await assert.rejects(run({ role: "explorer", goal: brief }), /did not finish in time/);
  stuck.release();
});

test("the agent tool is on top-level threads only, never on a child", async () => {
  const parentId = await newParent();
  const childId = await manager.spawnChild(parentId, { role: "implementer" });
  const toolNames = (id: string) => liveOf().get(id)!.session.getAllTools().map((t) => t.name);
  assert.ok(toolNames(parentId).includes("agent"));
  assert.ok(!toolNames(childId).includes("agent"));
  const reviewerId = await manager.spawnChild(parentId, { role: "reviewer" });
  assert.ok(!toolNames(reviewerId).includes("agent"));
});

test("continueId on a child that is still running is rejected", async () => {
  const parentId = await newParent();
  const run = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId } });
  const slow = gated("done");
  faux.setResponses([slow.step]);
  let childId: string | undefined;
  const first = run({ role: "explorer", goal: brief }, undefined, (u) => (childId ??= u.details.childThreadId));
  await waitFor(() => faux.state.callCount > 0 && childId !== undefined, "the child to be running");
  await assert.rejects(run({ goal: "follow-up", continueId: childId }), /still running/);
  slow.release();
  assert.ok((await first).content[0]!.text.startsWith("done"));
  // role is optional with continueId, and required without it
  faux.setResponses([piAi.fauxAssistantMessage("follow-up report")]);
  assert.ok((await run({ goal: "follow-up", continueId: childId })).content[0]!.text.startsWith("follow-up report"));
  await assert.rejects(run({ goal: brief }), /role is required/);
});

test("the in-flight counter is freed after a timeout and after a throw", async () => {
  const parentId = await newParent();
  const timing = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId }, timeoutMs: 20 });
  for (let i = 0; i <= MAX_RUNNING_CHILDREN; i++) {
    const stuck = gated("never");
    faux.setResponses([stuck.step]);
    await assert.rejects(timing({ role: "explorer", goal: brief }), /did not finish in time/, `timeout ${i}`);
    stuck.release();
  }
  const throwing = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId } });
  for (let i = 0; i <= MAX_RUNNING_CHILDREN; i++) {
    faux.setResponses([piAi.fauxAssistantMessage("  ")]);
    await assert.rejects(throwing({ role: "explorer", goal: brief }), /no final message/, `throw ${i}`);
  }
  faux.setResponses([piAi.fauxAssistantMessage("still works")]);
  assert.ok((await throwing({ role: "explorer", goal: brief })).content[0]!.text.startsWith("still works"));
});

test("a run that fails to start fails the tool promptly instead of waiting for the timeout", async () => {
  const parentId = await newParent();
  const childId = await manager.spawnChild(parentId, { role: "explorer" });
  const { session } = await manager.continueChild(childId);
  // Pi throws before the run starts (no model, auth failure, ...): no agent_settled follows.
  (session as unknown as { prompt: () => Promise<void> }).prompt = () => Promise.reject(new Error("No API key for provider: bogus"));
  const run = createAgentRunner({ reportFormat: false, threads: manager, ref: { threadId: parentId }, timeoutMs: 60_000 });
  const started = Date.now();
  await assert.rejects(run({ goal: brief, continueId: childId }), /No API key for provider: bogus/);
  assert.ok(Date.now() - started < 5_000);
  assert.equal((await manager.list()).find((t) => t.id === childId)?.status, "error");
});

test("a signal that aborts while the child is being spawned never dispatches the brief", async () => {
  const parentId = await newParent();
  const controller = new AbortController();
  let prompted = false;
  const threads = {
    spawnChild: async (...a: Parameters<Manager["spawnChild"]>) => {
      const id = await manager.spawnChild(...a);
      controller.abort();
      return id;
    },
    startPrompt: async (...a: Parameters<Manager["startPrompt"]>) => {
      prompted = true;
      return manager.startPrompt(...a);
    },
    continueChild: (id: string) => manager.continueChild(id),
    abort: (id: string) => manager.abort(id),
  };
  const result = await createAgentRunner({ reportFormat: false, threads, ref: { threadId: parentId } })({ role: "explorer", goal: brief }, controller.signal);
  assert.equal(result.details.aborted, true);
  assert.ok(result.details.childThreadId, "the spawned child is still reported");
  assert.equal(prompted, false);
});

test("agent tool description carries the brief guidance", async () => {
  const { describe } = await import("./subagent.ts");
  const { ROLES } = await import("./roles.ts");
  const text = describe(Object.values(ROLES));
  assert.match(text, /pointers/);
  assert.match(text, /acceptance/);
  assert.match(text, /containing code is rejected/);
});

test("a brief with code, or an implementer without acceptance, is rejected before any child spawns", async () => {
  const parentId = await newParent();
  const run = createAgentRunner({ threads: manager, ref: { threadId: parentId } });
  await assert.rejects(run({ role: "explorer", goal: "Do this:\n```ts\nfoo();\n```" }), /Remove the code/);
  await assert.rejects(run({ role: "implementer", goal: "Add the thing." }), /acceptance is required/);
});

test("a report without the required sections gets one follow-up; the reply is returned, capped", async () => {
  const parentId = await newParent();
  const prompts: string[] = [];
  const threads = {
    spawnChild: (...a: Parameters<Manager["spawnChild"]>) => manager.spawnChild(...a),
    startPrompt: (...a: Parameters<Manager["startPrompt"]>) => (prompts.push(a[1]), manager.startPrompt(...a)),
    continueChild: (...a: Parameters<Manager["continueChild"]>) => manager.continueChild(...a),
    abort: (...a: Parameters<Manager["abort"]>) => manager.abort(...a),
  };
  const run = createAgentRunner({ threads, ref: { threadId: parentId } });
  const formatted = `## Findings\n${"y".repeat(7000)}\n## Ran\nnone\n## Assumptions\nnone\n## Open questions\nnone`;
  faux.setResponses([piAi.fauxAssistantMessage("loose prose"), piAi.fauxAssistantMessage(formatted)]);
  const out = (await run({ role: "explorer", goal: brief })).content[0]!.text;
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /required report format/);
  assert.match(out, /\[truncated\]\n\n## Assumptions[^]*\[sub-agent thread/);
  assert.ok(!out.includes("loose prose"));
});
