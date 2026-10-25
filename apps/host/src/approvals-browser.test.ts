import assert from "node:assert/strict";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("approvals-browser-test", { cleanup: "exit" });
const { approvalExtension } = await import("./extensions.ts");

type Handler = (event: any, ctx: any) => Promise<any>;

/** The approvals extension against a fake Pi and a hub whose user answers `answer` (or is never asked, when `asked` stays 0). */
function setup(mode: "ask-writes" | "full-access" | "read-only", answer: { allow: boolean; always?: boolean } = { allow: true }) {
  let asked = 0;
  const hub = { ask: async () => (asked++, answer) } as never;
  const store = { config: { approvalMode: mode }, toolRules: undefined } as never;
  const ext = approvalExtension(hub, store, { threadId: "t" } as never);
  const handlers = new Map<string, Handler>();
  (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (name: string, h: Handler) => handlers.set(name, h), getAllTools: () => [] });
  return { asked: () => asked, call: (toolName: string, input: Record<string, unknown>) => handlers.get("tool_call")!({ toolName, input }, {}) };
}

test("an approved browser_click is not marked or changed: the browser tool asks again with the exact action at a stop", async () => {
  const s = setup("ask-writes");
  const input: Record<string, unknown> = { ref: "e3" };
  assert.equal(await s.call("browser_click", input), undefined);
  assert.equal(s.asked(), 1);
  assert.deepEqual(input, { ref: "e3" });
});

test("a declined browser_click is blocked", async () => {
  const s = setup("ask-writes", { allow: false });
  assert.equal((await s.call("browser_click", { ref: "e3" }))?.block, true);
});

test("full-access mode never prompts here; the browser tool's own stop does the asking", async () => {
  const s = setup("full-access");
  assert.equal(await s.call("browser_click", { ref: "e3" }), undefined);
  assert.equal(s.asked(), 0);
});
