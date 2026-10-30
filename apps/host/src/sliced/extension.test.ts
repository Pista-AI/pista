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
  assert.equal(board(id)?.phase, "integrate");
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
