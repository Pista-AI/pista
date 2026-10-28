import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxModels, liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("abort-label");
const { piAi, faux, models, ref } = await fauxModels();
const { manager, store, project } = await makeManager({ projectDir, models });
store.patchConfig({ defaultModel: ref, orchestratorMode: "delegate-read" });

type Msg = { role: string; stopReason?: string; errorMessage?: string };
const lastReply = (id: string) => liveOf<{ session: { messages: Msg[] } }>(manager).get(id)!.session.messages.findLast((m) => m.role === "assistant")!;

test("orchestrator: a loop-guard stop is recorded as aborted, not as an error", async () => {
  const id = (await manager.create(project.id)).summary.id;
  // delegate-read has no bash: four identical failures trip the loop guard, which aborts the run between turns.
  const bash = () => piAi.fauxAssistantMessage(piAi.fauxToolCall("bash", { command: "node --test" }));
  faux.setResponses([bash(), bash(), bash(), bash(), piAi.fauxAssistantMessage("NEVER-SENT")]);
  await (await manager.startPrompt(id, "go", undefined)).run;
  const last = lastReply(id);
  assert.equal(last.stopReason, "aborted", `ended on: ${last.stopReason} ${last.errorMessage}`);
  faux.setResponses([]);
});

test("an error reply on a run that was not aborted stays an error", async () => {
  const id = (await manager.create(project.id)).summary.id;
  faux.setResponses([piAi.fauxAssistantMessage([], { stopReason: "error", errorMessage: "401 invalid api key" })]);
  await (await manager.startPrompt(id, "go", undefined)).run;
  assert.equal(lastReply(id).stopReason, "error");
});
