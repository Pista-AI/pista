import assert from "node:assert/strict";
import { test } from "node:test";
import { orchestratorTools } from "./roles.ts";
import { fauxModels, liveOf as liveMap, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("orchestrator");
const { piAi, faux, models, ref } = await fauxModels();
const { manager, store, project } = await makeManager({ projectDir, models });
store.patchConfig({ defaultModel: ref });

type Live = { session: { messages: { role: string; content?: unknown }[]; getActiveToolNames(): string[]; prompt(text: string): Promise<void> } };
const kindOf = (id: string) => (manager as unknown as { children: { kindOf(id: string): { restricted: boolean; isChild: boolean; orchestratorTools?: string[]; orchestratorMode?: string } } }).children.kindOf(id);
const liveOf = () => liveMap<Live>(manager);

/** A new top-level thread under the given mode; the mode is read when the session is built. */
async function newThread(mode?: "off" | "delegate" | "delegate-read" | "lead") {
  store.patchConfig({ orchestratorMode: mode });
  return (await manager.create(project.id)).summary.id;
}

/** Prompts the thread once with the scripted replies and returns the tool names the model was sent on its first request. */
async function sentTools(id: string, replies: unknown[]) {
  let sent: string[] | undefined;
  faux.setResponses([
    (ctx: { messages: { sections?: { tools?: string } }[] }) => {
      // The faux context carries no tool definitions, only the system prompt's tool section ("- name: description" lines).
      sent = [...(ctx.messages[0]?.sections?.tools ?? "").matchAll(/^- (\w+):/gm)].map((m) => m[1]!);
      return replies[0] as never;
    },
    ...(replies.slice(1) as never[]),
  ]);
  await liveOf().get(id)!.session.prompt("go");
  return sent!.sort();
}

const results = (id: string) => liveOf().get(id)!.session.messages.filter((m) => m.role === "toolResult").map((m) => JSON.stringify(m.content));

test("delegate: the model is sent only agent and plan, and a read call is refused", async () => {
  const id = await newThread("delegate");
  assert.deepEqual([...liveOf().get(id)!.session.getActiveToolNames()].sort(), ["agent", "plan"]);
  const sent = await sentTools(id, [piAi.fauxAssistantMessage(piAi.fauxToolCall("read", { path: "x" })), piAi.fauxAssistantMessage("done")]);
  assert.deepEqual(sent, ["agent", "plan"]);
  // Pi itself rejects a tool that is not active; the gate (next test) covers a call that reaches the extension runner.
  assert.match(results(id)[0]!, /not found|Blocked/i);
  assert.doesNotMatch(results(id)[0]!, /export|import/, "no file content came back");
});

test("delegate: a bash call is blocked by the gate even though the tool is not advertised", async () => {
  const id = await newThread("delegate");
  const { session } = liveOf().get(id)! as unknown as { session: { extensionRunner: { emitToolCall(e: never): Promise<{ block?: boolean } | undefined> } } };
  for (const toolName of ["bash", "edit", "write", "read"]) assert.equal((await session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: toolName, toolName, input: {} } as never))?.block, true, toolName);
  assert.notEqual((await session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "a", toolName: "agent", input: {} } as never))?.block, true);
});

test("delegate: an agent call still works and returns the child's report", async () => {
  const id = await newThread("delegate");
  faux.setResponses([
    piAi.fauxAssistantMessage(piAi.fauxToolCall("agent", { role: "explorer", brief: "Report the entry point." })),
    piAi.fauxAssistantMessage("CHILD-REPORT"),
    piAi.fauxAssistantMessage("done"),
  ]);
  await liveOf().get(id)!.session.prompt("go");
  assert.match(results(id)[0]!, /CHILD-REPORT/);
});

test("delegate-read: read-only tools are present, edit, write and bash are not", async () => {
  const id = await newThread("delegate-read");
  const sent = await sentTools(id, [piAi.fauxAssistantMessage("done")]);
  assert.deepEqual(sent, ["agent", "find", "grep", "ls", "plan", "read"]);
});

test("a child of an orchestrator keeps its role's tools", async () => {
  const id = await newThread("delegate");
  const childId = await manager.spawnChild(id, { role: "implementer" });
  const child = (await manager.continueChild(childId)).session as unknown as { getActiveToolNames(): string[]; extensionRunner: { emitToolCall(e: never): Promise<{ block?: boolean } | undefined> } };
  const active = child.getActiveToolNames();
  assert.ok(active.includes("edit") && active.includes("bash"));
  assert.ok(!active.includes("agent"));
  const gate = await child.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "b", toolName: "bash", input: {} } as never);
  assert.doesNotMatch(String((gate as { reason?: string } | undefined)?.reason ?? ""), /orchestrator/, "the orchestrator gate is absent for children");
});

test("off and absent leave the full tool list", async () => {
  for (const mode of [undefined, "off" as const]) {
    const id = await newThread(mode);
    const sent = await sentTools(id, [piAi.fauxAssistantMessage("done")]);
    for (const tool of ["agent", "bash", "edit", "plan", "read", "write"]) assert.ok(sent.includes(tool), `${mode}: ${tool}`);
  }
});

test("switching the mode on and reloading idle threads restricts the reopened parent", async () => {
  const id = await newThread("off");
  faux.setResponses([piAi.fauxAssistantMessage("hi")]);
  await liveOf().get(id)!.session.prompt("go");
  assert.ok(liveOf().get(id)!.session.getActiveToolNames().includes("bash"));
  store.patchConfig({ orchestratorMode: "delegate" });
  await manager.reloadIdle();
  await manager.open(id);
  assert.deepEqual([...liveOf().get(id)!.session.getActiveToolNames()].sort(), ["agent", "plan"]);
});

test("only top-level orchestrator threads get the orchestrator prompt section", async () => {
  const promptOf = (id: string) => (liveOf().get(id)!.session as unknown as { systemPrompt: string }).systemPrompt;
  const delegate = await newThread("delegate");
  assert.match(promptOf(delegate), /## Orchestrator mode\nYou cannot read or edit files yourself/);
  const childId = await manager.spawnChild(delegate, { role: "implementer" });
  await manager.continueChild(childId);
  assert.doesNotMatch(promptOf(childId), /Orchestrator mode/);
  const reader = promptOf(await newThread("delegate-read"));
  assert.match(reader, /## Orchestrator mode\nYou can read files but not edit/);
  assert.match(reader, /Before you end, read the changed lines/);
  assert.doesNotMatch(promptOf(delegate), /Before you end, read the changed lines/);
  const lead = await newThread("lead");
  assert.match(promptOf(lead), /## Lead mode\nMake small edits yourself\. Delegate exploration/);
  assert.doesNotMatch(promptOf(lead), /Orchestrator mode/);
  const leadChild = await manager.spawnChild(lead, { role: "implementer" });
  await manager.continueChild(leadChild);
  assert.doesNotMatch(promptOf(leadChild), /Lead mode|Orchestrator mode/);
  assert.doesNotMatch(promptOf(await newThread("off")), /Orchestrator mode|Lead mode/);
  assert.doesNotMatch(promptOf(await newThread()), /Orchestrator mode/);
});

test("lead: the parent keeps every tool and the agent tool, with no orchestrator allowlist or gate", async () => {
  assert.equal(orchestratorTools("lead"), undefined);
  const id = await newThread("lead");
  const kind = kindOf(id);
  assert.equal(kind.restricted, false);
  assert.equal(kind.orchestratorTools, undefined);
  assert.equal(kind.orchestratorMode, "lead");
  const sent = await sentTools(id, [piAi.fauxAssistantMessage("done")]);
  for (const tool of ["agent", "bash", "edit", "plan", "read", "write"]) assert.ok(sent.includes(tool), tool);
  const { session } = liveOf().get(id)! as unknown as { session: { extensionRunner: { emitToolCall(e: never): Promise<{ block?: boolean } | undefined> } } };
  for (const toolName of ["bash", "edit", "write", "read"]) assert.doesNotMatch(String(((await session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: toolName, toolName, input: {} } as never)) as { reason?: string } | undefined)?.reason ?? ""), /orchestrator mode only allows/, toolName);
});

test("lead: a child has no orchestrator mode in its kind", async () => {
  const id = await newThread("lead");
  const childId = await manager.spawnChild(id, { role: "implementer" });
  assert.equal(kindOf(childId).orchestratorMode, undefined);
  assert.equal(kindOf(id).isChild, false);
});
