import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxModels, liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("tool-call-limit");
writeFileSync(join(projectDir, "a.txt"), "hello\n");
const { piAi, faux, models, ref } = await fauxModels();
// The extension loop guard pauses a local model at 40 calls; the faux model must look hosted for the host guard's cap to be what stops these runs.
const fauxModel = models.getModel(ref.provider, ref.id) as { baseUrl?: string };
fauxModel.baseUrl = "https://faux.example.invalid/v1";
const { manager, store, hub, project } = await makeManager({ projectDir, models });
store.patchConfig({ defaultModel: ref });

const toasts: string[] = [];
const emit = hub.emit.bind(hub);
hub.emit = (event) => {
  if (event.type === "toast") toasts.push(event.message);
  emit(event);
};

type Msg = { role: string; stopReason?: string };
const lastStop = (id: string) => liveOf<{ session: { messages: Msg[] } }>(manager).get(id)!.session.messages.findLast((m) => m.role === "assistant")!.stopReason;

/** Runs a thread through `calls` successful reads (varied so the repeat rules stay quiet) and reports whether the guard stopped it. */
async function stoppedAfter(id: string, calls: number): Promise<{ stopped: boolean; toast?: string }> {
  toasts.length = 0;
  const read = (i: number) => piAi.fauxAssistantMessage(piAi.fauxToolCall("read", { path: "a.txt", limit: i + 1 }));
  faux.setResponses([...Array.from({ length: calls }, (_, i) => read(i)), piAi.fauxAssistantMessage("done")]);
  await (await manager.startPrompt(id, "go", undefined)).run;
  faux.setResponses([]);
  return { stopped: lastStop(id) === "aborted", toast: toasts.find((t) => t.includes("tool calls")) };
}

const top = async () => (await manager.create(project.id)).summary.id;
const child = async (role: "explorer" | "implementer") => manager.spawnChild(await top(), { role });

test("the default cap of 60 still stops a run, and the toast names it", async () => {
  const { stopped, toast } = await stoppedAfter(await top(), 61);
  assert.ok(stopped);
  assert.match(toast ?? "", /the run reached 60 tool calls/);
  assert.equal((await stoppedAfter(await top(), 59)).stopped, false);
});

test("a role's maxToolCalls raises the cap for that role's sub-agents only", async () => {
  store.patchConfig({ agentOverrides: { explorer: { maxToolCalls: 70 } } });
  assert.equal((await stoppedAfter(await child("explorer"), 65)).stopped, false, "explorer runs past 60");
  const capped = await stoppedAfter(await child("explorer"), 71);
  assert.ok(capped.stopped);
  assert.match(capped.toast ?? "", /reached 70 tool calls/);
  assert.ok((await stoppedAfter(await child("implementer"), 61)).stopped, "implementer keeps 60");
  assert.ok((await stoppedAfter(await top(), 61)).stopped, "top-level keeps 60");
});

test("HostConfig.maxToolCalls raises the cap for top-level threads only", async () => {
  store.patchConfig({ agentOverrides: {}, maxToolCalls: 70 });
  assert.equal((await stoppedAfter(await top(), 65)).stopped, false);
  const capped = await stoppedAfter(await top(), 71);
  assert.match(capped.toast ?? "", /reached 70 tool calls/);
  assert.ok((await stoppedAfter(await child("explorer"), 61)).stopped, "sub-agents keep 60");
});

test("invalid values fall back to the default 60", async () => {
  for (const bad of [0, -5, 1.5, 1001, "150", null, Number.NaN]) {
    store.patchConfig({ maxToolCalls: bad as never, agentOverrides: { explorer: { maxToolCalls: bad as never } } });
    assert.ok((await stoppedAfter(await top(), 61)).stopped, `top-level ${String(bad)}`);
    assert.ok((await stoppedAfter(await child("explorer"), 61)).stopped, `explorer ${String(bad)}`);
  }
});
