import assert from "node:assert/strict";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("browsing-turns-test", { cleanup: "exit" });
const { browserToolBeforeRequest, browsingTurnsExtension, quietPlannerPayload } = await import("./browsing-turns.ts");

const call = (name: string) => ({ id: "c", type: "function", function: { name, arguments: "{}" } });
const afterTool = (name: string, extra: object = {}) => ({
  model: "m",
  reasoning_effort: "medium",
  messages: [{ role: "user", content: "go" }, { role: "assistant", content: null, tool_calls: [call(name)] }, { role: "tool", tool_call_id: "c", content: "{}" }],
  ...extra,
});

test("a request that follows browser tool results gets temperature 0 and keeps its thinking level", () => {
  const input = afterTool("browser_click");
  const out = quietPlannerPayload(input) as Record<string, unknown>;
  assert.equal(out.temperature, 0);
  assert.equal(out.reasoning_effort, "medium");
  assert.equal((input as Record<string, unknown>).temperature, undefined, "the input is not mutated");
  assert.equal(out.model, "m");
});

test("replayed reasoning on earlier assistant turns is left alone", () => {
  const payload = afterTool("browser_click");
  (payload.messages[1] as Record<string, unknown>).reasoning_content = "I should click the button";
  const out = quietPlannerPayload(payload) as { messages: Record<string, unknown>[] };
  assert.equal(out.messages[1]!.reasoning_content, "I should click the button");
});

test("the first call of a user message, other tools, and non-chat payloads are left alone", () => {
  assert.equal(quietPlannerPayload({ messages: [{ role: "user", content: "go" }] }), undefined);
  assert.equal(quietPlannerPayload(afterTool("bash")), undefined);
  assert.equal(quietPlannerPayload({ input: [] }), undefined);
  assert.equal(quietPlannerPayload(null), undefined);
  assert.equal(browserToolBeforeRequest(afterTool("browser_read")), "browser_read");
});

test("a payload without a reasoning level gets none added", () => {
  const payload = afterTool("browser_snapshot");
  delete (payload as { reasoning_effort?: string }).reasoning_effort;
  const out = quietPlannerPayload(payload) as Record<string, unknown>;
  assert.ok(!("reasoning_effort" in out));
  assert.equal(out.temperature, 0);
});

type Handler = (event: unknown, ctx: unknown) => unknown;
function hooked(mode: string | undefined) {
  const handlers = new Map<string, Handler>();
  const ext = browsingTurnsExtension({ config: { localServers: [] }, thinkingMode: () => mode as never });
  (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (n: string, h: Handler) => handlers.set(n, h) });
  const before = (payload: unknown, model: object) => handlers.get("before_provider_request")!({ payload }, { model });
  return { before, start: () => handlers.get("agent_start")!({}, {}) };
}
const LOCAL = { provider: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" };

test("only auto thinking on a local model is adjusted; an explicit level or a cloud model is untouched", () => {
  const p = afterTool("browser_click");
  assert.equal((hooked("auto").before(p, LOCAL) as { temperature: number }).temperature, 0);
  assert.equal(hooked("high").before(p, LOCAL), undefined);
  assert.equal(hooked("off").before(p, LOCAL), undefined);
  assert.equal(hooked(undefined).before(p, LOCAL), undefined);
  assert.equal(hooked("auto").before(p, { provider: "openai", baseUrl: "https://api.openai.com/v1" }), undefined);
});

test("one log line per browsing sequence", () => {
  const h = hooked("auto");
  const lines: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    h.start();
    h.before(afterTool("browser_navigate"), LOCAL);
    h.before(afterTool("browser_click"), LOCAL);
    h.before({ messages: [{ role: "user", content: "next" }] }, LOCAL);
    h.before(afterTool("browser_type"), LOCAL);
  } finally {
    console.log = original;
  }
  assert.deepEqual(lines, ["[browsing-turns] temp 0 (after browser_navigate)", "[browsing-turns] temp 0 (after browser_type)"]);
});
