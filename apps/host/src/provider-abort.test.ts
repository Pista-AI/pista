import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { INTERRUPTED_PREFIX, isProviderAbort } from "./provider-abort.ts";
import { fauxModels, liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir, agentDir } = setupHome("provider-abort");
// Pi's retry backoff starts at 2 s; keep the test fast.
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { baseDelayMs: 1 } }));
const { piAi, faux, models, ref } = await fauxModels();
const { manager, store, project } = await makeManager({ projectDir, models });
store.patchConfig({ defaultModel: ref, orchestratorMode: "delegate-read" });

type Msg = { role: string; stopReason?: string; errorMessage?: string; content: { type: string; text?: string }[] };
const ABORTED = "This operation was aborted";

test("isProviderAbort: only an error reply with an abort text the host did not cause", () => {
  assert.equal(isProviderAbort({ role: "assistant", stopReason: "error", errorMessage: ABORTED }), true);
  assert.equal(isProviderAbort({ role: "assistant", stopReason: "error", errorMessage: "The operation was aborted" }), true);
  // Stop, the sub-agent timeout and the loop guard abort the run's signal: Pi records "aborted", which is never retried.
  assert.equal(isProviderAbort({ role: "assistant", stopReason: "aborted", errorMessage: ABORTED }), false);
  assert.equal(isProviderAbort({ role: "assistant", stopReason: "error", errorMessage: "401 invalid api key" }), false);
  assert.equal(isProviderAbort({ role: "assistant", stopReason: "error", errorMessage: `${INTERRUPTED_PREFIX}: ${ABORTED}` }), false);
});

test("orchestrator: a provider abort on the turn after a sub-agent is retried instead of ending the run", async () => {
  const id = (await manager.create(project.id)).summary.id;
  faux.setResponses([
    piAi.fauxAssistantMessage(piAi.fauxToolCall("agent", { role: "explorer", brief: "Report the entry point." })),
    piAi.fauxAssistantMessage("CHILD-REPORT"),
    // What an OpenAI-compatible server's in-stream error event becomes: stopReason "error", not "aborted".
    piAi.fauxAssistantMessage([], { stopReason: "error", errorMessage: ABORTED }),
    piAi.fauxAssistantMessage("PARENT-DONE"),
  ]);
  const { run } = await manager.startPrompt(id, "go", undefined);
  await run;
  const messages = (liveOf<{ session: { messages: Msg[] } }>(manager).get(id)!.session.messages);
  const last = messages.findLast((m) => m.role === "assistant")!;
  assert.equal(last.stopReason, "stop", `run ended on: ${last.errorMessage}`);
  assert.equal(last.content.map((b) => b.text ?? "").join(""), "PARENT-DONE");
  assert.equal(faux.getPendingResponseCount?.() ?? 0, 0);
});

test("orchestrator: a loop-guard stop is recorded as aborted, not as a provider stream failure", async () => {
  const id = (await manager.create(project.id)).summary.id;
  // delegate-read has no bash: four identical failures trip the loop guard, which aborts the run between turns.
  const bash = () => piAi.fauxAssistantMessage(piAi.fauxToolCall("bash", { command: "node --test" }));
  faux.setResponses([bash(), bash(), bash(), bash(), piAi.fauxAssistantMessage("NEVER-SENT")]);
  const { run } = await manager.startPrompt(id, "go", undefined);
  await run;
  const messages = liveOf<{ session: { messages: Msg[] } }>(manager).get(id)!.session.messages;
  const last = messages.findLast((m) => m.role === "assistant")!;
  assert.equal(last.stopReason, "aborted");
  assert.doesNotMatch(last.errorMessage ?? "", new RegExp(INTERRUPTED_PREFIX));
  faux.setResponses([]);
});
