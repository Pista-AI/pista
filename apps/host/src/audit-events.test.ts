import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createOtlpAudit, type AuditSink } from "./audit.ts";
import { secretValues } from "./audit-policy.ts";
import { classifyTool, emitPrompt, emitUsage, safeStringify, scopeAudit, scrub, truncate } from "./audit-events.ts";
import { setupHome } from "./test-helpers.ts";

setupHome("audit-events-test", { cleanup: "exit" });
const { policyGateExtension } = await import("./extensions.ts");
const { auditToolsExtension, observeBlocks, ToolAudit } = await import("./audit-events.ts");

const SECRET = "sk-live-abcdef123456";
const ENV = { MY_API_KEY: SECRET, AUDIT_TOKEN: "collector-secret-9", HOME: "/home/x" };

test("tools are classified without leaking paths, full URLs or command lines", () => {
  assert.deepEqual(classifyTool("mcp__github__create_issue", {}), { kind: "mcp", attrs: { "mcp.server": "github", "mcp.tool": "create_issue" } });
  assert.deepEqual(classifyTool("browser_navigate", { url: "https://example.com/a?token=1" }).attrs, { "browser.action": "navigate", "url.domain": "example.com" });
  assert.equal(classifyTool("browser_click", {}).kind, "browser");
  assert.deepEqual(classifyTool("bash", { command: "/usr/bin/git push origin" }), { kind: "shell", attrs: { "shell.command_name": "git" } });
  assert.equal(classifyTool("bash", { command: "API_KEY=abc123 curl https://x" }).attrs["shell.command_name"], "curl");
  assert.equal(classifyTool("bash", { command: "FOO=1" }).attrs["shell.command_name"], undefined);
  assert.equal(classifyTool("plan", {}).kind, "internal");
  assert.equal(classifyTool("read", { path: "/etc/passwd" }).kind, "builtin");
});

test("scrub redacts secret-looking keys and secret env values", () => {
  const secrets = secretValues({ ...ENV, SHORT_TOKEN: "abc" }, { authorization: "OTHER_HEADER" });
  assert.deepEqual(secrets.sort(), [SECRET, "collector-secret-9"].sort());
  const text = JSON.stringify(scrub({ cmd: 'curl -H "Authorization: Bearer x" --api key=zz token:abc' }, secrets));
  assert.ok(!/Bearer x|=zz|token:abc/.test(text) && text.includes("[redacted]"));
  assert.equal(safeStringify(undefined), "");
  assert.equal(safeStringify({ n: 1n }), '{"n":"1"}');
  const loop: any = {};
  loop.self = loop;
  assert.ok(safeStringify(scrub(loop, [])).includes("circular"));
  assert.equal(truncate("a😀", 2), "a");
  const out = JSON.stringify(scrub({ password: "p", nested: { Authorization: "x", note: `key is ${SECRET}` }, list: ["ok"] }, secrets));
  assert.ok(!out.includes(SECRET) && !out.includes('"p"') && out.includes("ok") && out.includes("[redacted]"));
});

/** Runs extensions like Pi: handlers in order, a block ends the chain. */
function pi(exts: { factory: (p: never) => unknown }[]) {
  const handlers = new Map<string, ((e: any, c: any) => any)[]>();
  for (const ext of exts) ext.factory({ on: (n: string, h: never) => handlers.set(n, [...(handlers.get(n) ?? []), h]), getActiveTools: () => [], setActiveTools() {} } as never);
  return {
    async call(toolName: string, input: unknown, toolCallId = "c1") {
      for (const h of handlers.get("tool_call") ?? []) {
        const r = await h({ toolName, input, toolCallId }, {});
        if (r?.block) return r;
      }
      return undefined;
    },
  };
}

async function run(flags: { includePrompts?: boolean; includeToolArgs?: boolean }) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(body);
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = createOtlpAudit({ policy: { otlpEndpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, headersEnv: { authorization: "AUDIT_TOKEN" }, ...flags }, version: "1", env: ENV, warn() {} });
  const audit: AuditSink = scopeAudit(base, () => ({ "session.id": "t1", "project.id": "p1" }));
  const rules = {
    checkTool: (n: string) => (n === "forbidden" ? { rule: "tools.deny", reason: "no" } : null),
    checkBash: () => null,
    checkMcp: () => null,
    skillAllowed: () => true,
  };
  const tools = new ToolAudit(audit);
  const chain = pi([
    // Stands in for a user/project extension: not observed, so the session end event must catch it.
    { name: "user", factory: (p: any) => p.on("tool_call", (e: any) => (e.toolName === "userblocked" ? { block: true, reason: "ext" } : undefined)) },
    observeBlocks({ name: "x", factory: (p: any) => p.on("tool_call", (e: any) => { if (e.toolName === "boom") throw new Error("gate"); return e.toolName === "looped" ? { block: true, reason: "loop" } : undefined; }) } as never, "loop_guard", tools),
    policyGateExtension(rules, (name, input, d, id) => tools.decision(id, name, input, "deny", { source: "policy", rule: d.rule })) as never,
    auditToolsExtension(tools) as never,
  ] as never);
  /** What the session does around a call: start event, the extension chain, end event. */
  const call = async (name: string, input: unknown, id: string) => {
    tools.start({ toolCallId: id, toolName: name, args: input });
    try { await chain.call(name, input, id); } catch {}
    tools.end({ toolCallId: id, isError: false });
  };
  emitPrompt(audit, `please use ${SECRET}`);
  await call("bash", { command: `API_KEY=abc123 curl -H 'x: ${SECRET}' https://secret.example/path?q=1`, apiKey: "zzz-key" }, "c1");
  await call("forbidden", {}, "c2");
  await call("looped", {}, "c3");
  await call("userblocked", {}, "c4");
  await call("boom", {}, "c5");
  emitUsage(audit, [{ role: "assistant", content: [], provider: "openai", model: "gpt-x", stopReason: "stop", timestamp: 0, usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18, cost: { total: 0.01 } } }], 0);
  await base.dispose();
  server.close();
  const records = requests.flatMap((b) => JSON.parse(b).resourceLogs[0].scopeLogs[0].logRecords);
  return { body: requests.join("\n"), records, names: records.map((r: any) => r.attributes.find((a: any) => a.key === "event.name").value.stringValue) };
}

test("flags off: decisions, results and usage are recorded; no prompt, args, command line, URL or secret appears", async () => {
  const { body, records, names } = await run({});
  assert.deepEqual(names, ["pista.prompt", "pista.tool.decision", "pista.tool.result", ...Array(4).fill(["pista.tool.decision", "pista.tool.result"]).flat(), "pista.model.usage"]);
  assert.ok(body.includes("gate.error") && body.includes('"extension"'));
  assert.ok(!body.includes("abc123") && body.includes('"curl"'));
  for (const leak of [SECRET, "collector-secret-9", "please use", "curl -H", "API_KEY", "secret.example", "zzz-key", "apiKey"]) assert.ok(!body.includes(leak), leak);
  assert.ok(body.includes("shell.command_name"));
  assert.ok(body.includes("gen_ai.usage.input_tokens") && body.includes("gen_ai.usage.cache_read.input_tokens"));
  const deny = records.find((r: any) => r.attributes.some((a: any) => a.key === "decision.rule"));
  assert.ok(JSON.stringify(deny).includes("tools.deny"));
  assert.ok(body.includes("loop_guard") && body.includes('"stringValue":"t1"'));
});

test("flags on: prompt and args appear in bodies, secrets still redacted", async () => {
  const { body, records } = await run({ includePrompts: true, includeToolArgs: true });
  assert.ok(body.includes("please use") && body.includes("curl") && body.includes("secret.example"));
  for (const leak of [SECRET, "collector-secret-9", "zzz-key", "abc123"]) assert.ok(!body.includes(leak), leak);
  assert.ok(records.every((r: any) => !r.body || r.body.stringValue.length <= 4096));
});
