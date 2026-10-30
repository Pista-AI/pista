import assert from "node:assert/strict";
import { test } from "node:test";
import { ENTRY, readSliceBoard } from "../session.ts";
import { fauxModels, liveOf as liveMap, makeManager, setupHome } from "../test-helpers.ts";

const { projectDir } = setupHome("sliced-ext");
const { piAi, faux, models, ref } = await fauxModels();
const { manager, store, project } = await makeManager({ projectDir, models });
store.patchConfig({ defaultModel: ref, orchestratorMode: "sliced", sliced: { minSlices: 2 } });

type Live = { session: { messages: { role: string; content?: unknown }[]; sessionManager: never; extensionRunner: { emitToolCall(e: never): Promise<{ block?: boolean } | undefined> }; prompt(text: string): Promise<void> } };
const liveOf = () => liveMap<Live>(manager);
const newThread = async () => (await manager.create(project.id)).summary.id;
const session = (id: string) => liveOf().get(id)!.session;
const board = (id: string) => readSliceBoard(session(id).sessionManager);
const results = (id: string) => session(id).messages.filter((m) => m.role === "toolResult").map((m) => JSON.stringify(m.content));
const blocked = async (id: string, toolName: string) => (await session(id).extensionRunner.emitToolCall({ type: "tool_call", toolCallId: toolName, toolName, input: {} } as never))?.block === true;

const slice = (id: string) => ({ id, title: `Title ${id}`, goal: "g", files_or_areas: [`src/${id}`], acceptance: "pnpm test" });
const slicesCall = (slices: unknown[]) => piAi.fauxAssistantMessage(piAi.fauxToolCall("slices", { slices, fits_solo: false, reason: "r" }));

test("a model that never calls slices is nudged twice, then runs solo with tools unblocked", async () => {
  const id = await newThread();
  assert.equal(await blocked(id, "bash"), true);
  assert.equal(await blocked(id, "read"), false);
  const attempt = () => piAi.fauxAssistantMessage(piAi.fauxToolCall("bash", { command: "ls" }));
  faux.setResponses([attempt(), piAi.fauxAssistantMessage("one"), attempt(), piAi.fauxAssistantMessage("two"), attempt(), piAi.fauxAssistantMessage("three")]);
  await session(id).prompt("change it");
  assert.equal(board(id)?.phase, "solo");
  assert.equal(board(id)?.nudges, 2);
  assert.equal(await blocked(id, "bash"), false);
});

test("a plain answer without tool calls lifts the gate silently", async () => {
  const id = await newThread();
  faux.setResponses([piAi.fauxAssistantMessage("It is a monorepo.")]);
  await session(id).prompt("what is this?");
  assert.equal(board(id)?.phase, "solo");
  assert.equal(board(id)?.nudges, 0);
  assert.equal(await blocked(id, "bash"), false);
});

test("a provider error does not nudge or change the phase", async () => {
  const id = await newThread();
  faux.setResponses([piAi.fauxAssistantMessage("x", { stopReason: "error", errorMessage: "boom" })]);
  await session(id).prompt("go").catch(() => undefined);
  assert.notEqual(board(id)?.phase, "solo");
  assert.equal(board(id)?.nudges ?? 0, 0);
});

test("an unfinished board survives a new user message and is read back from the session", async () => {
  const id = await newThread();
  const pending = { slices: [{ id: "a", title: "Pending a", goal: "g", filesOrAreas: ["src/a"], acceptance: "t", dependsOn: [] }], fitsSolo: false, reason: "r", phase: "dispatch", status: { a: "running" }, nudges: 0 };
  (session(id).sessionManager as unknown as { appendCustomEntry(t: string, d: unknown): void }).appendCustomEntry(ENTRY.slices, pending);
  let seen = "";
  faux.setResponses([
    (ctx: { messages: unknown[] }) => {
      seen = JSON.stringify(ctx.messages.at(-1));
      return piAi.fauxAssistantMessage("ok");
    },
  ]);
  await session(id).prompt("again");
  assert.match(seen, /Pending a/);
  assert.equal(board(id)?.status.a, "running");
});

test("an invalid list returns an error and the phase stays plan", async () => {
  const id = await newThread();
  let phaseAfterError: string | undefined;
  faux.setResponses([
    slicesCall([slice("a"), slice("a")]),
    () => {
      phaseAfterError = board(id)?.phase ?? "plan";
      return piAi.fauxAssistantMessage("done");
    },
    piAi.fauxAssistantMessage("done"),
    piAi.fauxAssistantMessage("done"),
  ]);
  await session(id).prompt("go");
  assert.match(results(id)[0]!, /duplicate slice id/);
  assert.equal(phaseAfterError, "plan");
});

test("a valid list below minSlices proceeds solo and lifts the gate", async () => {
  const id = await newThread();
  faux.setResponses([slicesCall([slice("a")]), piAi.fauxAssistantMessage("done")]);
  await session(id).prompt("go");
  assert.match(results(id)[0]!, /Proceed solo: fewer than 2 slices/);
  assert.equal(board(id)?.phase, "solo");
  assert.equal(await blocked(id, "bash"), false);
});

test("a valid list above minSlices dispatches one implementer per slice and ends in the integrate phase", async () => {
  const id = await newThread();
  const report = (what: string) => piAi.fauxAssistantMessage(`## Changed\n${what}\n\n## Ran\nnone\n\n## Assumptions\nnone\n\n## Open questions\nnone`);
  // One shared faux queue: the parent's call, then each child's report in wave order, then the parent's answer.
  faux.setResponses([slicesCall([slice("a"), slice("b")]), report("did slice one"), report(`did slice two ${"x".repeat(3000)}END`), piAi.fauxAssistantMessage("done")]);
  await session(id).prompt("go");
  const result = results(id)[0]!;
  assert.match(result, /Dispatch finished/);
  assert.match(result, /did slice one/);
  assert.match(result, /did slice two/);
  assert.doesNotMatch(result, /END/, "reports are clipped");
  assert.match(result, /## a done \(unverified: no edits\)/);
  assert.ok(result.indexOf("Title a") < result.indexOf("## a"), "status table comes before the reports");
  assert.match(result, /Check the reports against the request/);
  assert.equal(board(id)?.phase, "done", "nothing failed, so the run settles straight to done");
  assert.deepEqual(board(id)?.status, { a: "done", b: "done" });
  assert.equal(await blocked(id, "bash"), false);
});

test("the board is injected into the next request", async () => {
  const id = await newThread();
  let last = "";
  faux.setResponses([
    slicesCall([slice("a")]),
    (ctx: { messages: unknown[] }) => {
      last = JSON.stringify(ctx.messages.at(-1));
      return piAi.fauxAssistantMessage("done");
    },
  ]);
  await session(id).prompt("go");
  assert.match(last, /Slice board/);
  assert.match(last, /Title a/);
  assert.equal(session(id).messages.some((m) => JSON.stringify(m.content).includes("Slice board")), false, "not stored in the transcript");
});

test("a new user message after the board is finished starts a new plan", async () => {
  const id = await newThread();
  faux.setResponses([slicesCall([slice("a")]), piAi.fauxAssistantMessage("done")]);
  await session(id).prompt("go");
  assert.equal(board(id)?.phase, "solo");
  faux.setResponses([piAi.fauxAssistantMessage("x")]);
  await session(id).prompt("next");
  assert.equal(board(id)?.slices.length, 0);
  assert.equal(board(id)?.phase, "solo");
});

const seed = (id: string, phase: string, status: Record<string, string>) => {
  const slices = Object.keys(status).map((k) => ({ id: k, title: `Title ${k}`, goal: "g", filesOrAreas: [`src/${k}`], acceptance: "t", dependsOn: [] }));
  (session(id).sessionManager as unknown as { appendCustomEntry(t: string, d: unknown): void }).appendCustomEntry(ENTRY.slices, { slices, fitsSolo: false, reason: "r", phase, status, nudges: 0 });
};

test("integrate gate: full leaves every tool open, read-only keeps read tools, plan and agent", async () => {
  const id = await newThread();
  seed(id, "integrate", { a: "done", b: "running" });
  assert.equal(await blocked(id, "bash"), false);
  store.patchConfig({ sliced: { minSlices: 2, integrateTools: "read-only" } });
  try {
    assert.equal(await blocked(id, "bash"), true);
    assert.equal(await blocked(id, "write"), true);
    for (const tool of ["read", "grep", "find", "ls", "plan", "agent"]) assert.equal(await blocked(id, tool), false, tool);
  } finally {
    store.patchConfig({ sliced: { minSlices: 2 } });
  }
});

test("a failed slice the answer never mentions gets one reminder; mentioning it needs none", async () => {
  const id = await newThread();
  seed(id, "integrate", { a: "done", b: "failed", c: "running" });
  let steer = "";
  faux.setResponses([
    piAi.fauxAssistantMessage("All good."),
    (ctx: { messages: unknown[] }) => {
      steer = JSON.stringify(ctx.messages);
      return piAi.fauxAssistantMessage("Slice b failed.");
    },
  ]);
  await session(id).prompt("status?");
  assert.match(steer, /must mention the failed\/skipped slices: b/);
  assert.equal(board(id)?.integrateNudges, 1);
  assert.equal(board(id)?.phase, "done");

  const id2 = await newThread();
  seed(id2, "integrate", { a: "done", b: "skipped", c: "running" });
  faux.setResponses([piAi.fauxAssistantMessage("Everything but Title b is done.")]);
  await session(id2).prompt("status?");
  assert.equal(board(id2)?.integrateNudges ?? 0, 0);
  assert.equal(board(id2)?.phase, "done");
});

test("a short id is matched as a whole word, not inside other words", async () => {
  const id = await newThread();
  seed(id, "integrate", { a: "failed", b: "running" });
  faux.setResponses([piAi.fauxAssistantMessage("The cat sat; all fine."), piAi.fauxAssistantMessage("Slice a failed.")]);
  await session(id).prompt("status?");
  assert.equal(board(id)?.integrateNudges, 1);
});

test("a run that does not complete in integrate ends it, and tools are open again in done even when read-only", async () => {
  store.patchConfig({ sliced: { minSlices: 2, integrateTools: "read-only" } });
  try {
    const id = await newThread();
    seed(id, "integrate", { a: "failed", b: "running" });
    assert.equal(await blocked(id, "bash"), true, "gate holds in integrate, read from the stored board");
    faux.setResponses([piAi.fauxAssistantMessage("x", { stopReason: "error", errorMessage: "boom" })]);
    await session(id).prompt("go").catch(() => undefined);
    assert.equal(board(id)?.phase, "done");
    assert.equal(await blocked(id, "bash"), false);
  } finally {
    store.patchConfig({ sliced: { minSlices: 2 } });
  }
});

test("an integrate board is not wiped by a user message even when every slice is terminal", async () => {
  const id = await newThread();
  seed(id, "integrate", { a: "done", b: "failed" });
  faux.setResponses([piAi.fauxAssistantMessage("Slice b failed."), piAi.fauxAssistantMessage("unused")]);
  await session(id).prompt("hm");
  assert.equal(board(id)?.slices.length, 2);
});

test("the reminder is sent once even when the answer still omits the slice", async () => {
  const id = await newThread();
  seed(id, "integrate", { a: "failed", b: "running" });
  faux.setResponses([piAi.fauxAssistantMessage("fine"), piAi.fauxAssistantMessage("still fine"), piAi.fauxAssistantMessage("unused")]);
  await session(id).prompt("status?");
  assert.equal(board(id)?.integrateNudges, 1);
  assert.equal(board(id)?.phase, "done");
});

test("integrate with pending slices survives a user message; after done the next message resets", async () => {
  const id = await newThread();
  seed(id, "integrate", { a: "done", b: "pending" });
  faux.setResponses([piAi.fauxAssistantMessage("ok")]);
  await session(id).prompt("hm");
  assert.equal(board(id)?.slices.length, 2, "kept");
  assert.equal(board(id)?.phase, "done");
  faux.setResponses([piAi.fauxAssistantMessage("ok")]);
  await session(id).prompt("next");
  assert.equal(board(id)?.slices.length, 0, "reset");
});
