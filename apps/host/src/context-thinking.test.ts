import assert from "node:assert/strict";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("context-thinking-test", { cleanup: "exit" });
const { contextPruneExtension, stripOldThinking } = await import("./context-prune.ts");

type Part = { type: string; text?: string; thinking?: string };
type Msg = { role: string; content: Part[] | string };

const user = (text: string): Msg => ({ role: "user", content: text });
const result = (): Msg => ({ role: "toolResult", content: [{ type: "text", text: "r" }] });
const withThinking = (thinking: string): Msg => ({ role: "assistant", content: [{ type: "thinking", thinking }, { type: "text", text: "ok" }] });
const types = (m: Msg) => (m.content as Part[]).map((p) => p.type);

test("stripOldThinking drops thinking from older assistant messages only, without mutating", () => {
  const messages = [user("go"), withThinking("one"), result(), withThinking("two"), result(), withThinking("three")];
  const before = JSON.stringify(messages);
  const out = stripOldThinking(messages);
  assert.equal(JSON.stringify(messages), before);
  assert.deepEqual(out.filter((m) => m.role === "assistant").map(types), [["text"], ["text"], ["thinking", "text"]]);
  const untouched = [user("go"), { role: "assistant", content: [{ type: "text", text: "hi" }] }];
  assert.equal(stripOldThinking(untouched), untouched);
});

test("the context hook strips thinking for local providers only", () => {
  const run = (model: { provider: string; baseUrl: string }) => {
    let handler: ((e: unknown, c: unknown) => unknown) | undefined;
    const ext = contextPruneExtension({ config: { localServers: [] } } as never);
    (ext as unknown as { factory: (pi: unknown) => void }).factory({ on: (_: string, h: typeof handler) => (handler = h) });
    const messages = [user("go"), withThinking("a"), result(), withThinking("b")];
    return { messages, out: handler!({ messages }, { model }) as { messages: Msg[] } | undefined };
  };
  const local = run({ provider: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" });
  assert.deepEqual(types(local.out!.messages[1]!), ["text"]);
  assert.deepEqual(types(local.out!.messages[3]!), ["thinking", "text"]);
  assert.deepEqual(types(local.messages[1]!), ["thinking", "text"], "stored messages are untouched");
  assert.equal(run({ provider: "openai", baseUrl: "https://api.openai.com/v1" }).out, undefined);
});
