import assert from "node:assert/strict";
import { test } from "node:test";
import type { ManagedPolicy } from "@pista/protocol";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerPolicyGateways } from "./policy-providers.ts";

type Call = { id: string; config: any };
const collect = () => {
  const calls: Call[] = [];
  return { calls, register: ((id: string, config: unknown) => void calls.push({ id, config })) as never };
};
const policy = (...gateways: NonNullable<ManagedPolicy["providers"]>["gateways"] & object): ManagedPolicy => ({ version: 1, providers: { gateways } });
const openai = {
  id: "corp",
  name: "Corp",
  kind: "openai-compatible" as const,
  baseUrl: "https://llm.example.com/v1",
  apiKeyEnv: "LLM_GATEWAY_KEY",
  headers: { "X-Team": "$TEAM" },
  models: [{ id: "gpt-x", name: "GPT X", contextWindow: 200_000, maxTokens: 8192, reasoning: true }, { id: "plain" }],
};

test("registers an openai-compatible gateway with an env key reference, headers and models", () => {
  const { calls, register } = collect();
  const result = registerPolicyGateways(policy(openai), { LLM_GATEWAY_KEY: "dummy", TEAM: "t" }, register);
  assert.deepEqual(result, { registered: 1, warnings: [] });
  const { id, config } = calls[0]!;
  assert.equal(id, "corp");
  assert.equal(config.name, "Corp");
  assert.equal(config.baseUrl, "https://llm.example.com/v1");
  assert.equal(config.api, "openai-completions");
  assert.equal(config.apiKey, "$LLM_GATEWAY_KEY");
  assert.deepEqual(config.headers, { "X-Team": "$TEAM" });
  assert.equal(config.models.length, 2);
  assert.equal(config.models[0].id, "gpt-x");
  assert.equal(config.models[0].name, "GPT X");
  assert.equal(config.models[0].contextWindow, 200_000);
  assert.equal(config.models[0].maxTokens, 8192);
  assert.equal(config.models[0].reasoning, true);
  assert.equal(config.models[0].compat.supportsDeveloperRole, false);
  assert.equal(config.models[1].name, "plain");
  assert.equal(config.models[1].reasoning, false);
  assert.equal(config.models[1].maxTokens, 16_384);
});

test("maps anthropic-compatible to the Anthropic messages api", () => {
  const { calls, register } = collect();
  registerPolicyGateways(policy({ ...openai, kind: "anthropic-compatible" }), { LLM_GATEWAY_KEY: "dummy", TEAM: "t" }, register);
  assert.equal(calls[0]!.config.api, "anthropic-messages");
  assert.equal(calls[0]!.config.models[0].api, "anthropic-messages");
  assert.equal("compat" in calls[0]!.config.models[0], false);
});

test("a missing key variable still registers, with a warning that names the variable and no value", () => {
  const { calls, register } = collect();
  const result = registerPolicyGateways(policy(openai), { TEAM: "t" }, register);
  assert.equal(calls.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /LLM_GATEWAY_KEY is not set, its models stay unavailable/);
});

test("no apiKeyEnv registers with a placeholder key and no warning; no policy registers nothing", () => {
  const { calls, register } = collect();
  const { apiKeyEnv: _unused, ...keyless } = openai;
  assert.deepEqual(registerPolicyGateways(policy(keyless), { TEAM: "t" }, register).warnings, []);
  assert.equal(calls[0]!.config.apiKey, "gateway");
  assert.deepEqual(registerPolicyGateways(null, {}, register), { registered: 0, warnings: [] });
  assert.deepEqual(registerPolicyGateways({ version: 1 }, {}, register), { registered: 0, warnings: [] });
  assert.equal(calls.length, 1);
});

test("a registration that throws becomes a warning and the next gateway still registers", () => {
  const registered: string[] = [];
  const register = ((id: string) => {
    if (id === "corp") throw new Error("boom");
    registered.push(id);
  }) as never;
  const result = registerPolicyGateways(policy(openai, { ...openai, id: "second" }), { LLM_GATEWAY_KEY: "dummy", TEAM: "t" }, register);
  assert.deepEqual(registered, ["second"]);
  assert.equal(result.registered, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /corp.*boom/);
});

test("a gateway whose id is already registered is skipped with a warning", () => {
  const { calls, register } = collect();
  const result = registerPolicyGateways(policy({ ...openai, id: "anthropic" }, { ...openai, id: "ok" }), { LLM_GATEWAY_KEY: "dummy", TEAM: "t" }, register, ["anthropic", "openai"]);
  assert.deepEqual(calls.map((c) => c.id), ["ok"]);
  assert.match(result.warnings[0]!, /anthropic.*already registered/);
});

test("unset $NAME and ${NAME} references in headers warn, escapes and set variables do not", () => {
  const { register } = collect();
  const gateway = { ...openai, headers: { A: "$TEAM", B: "x-${REGION}-y", C: "$$LITERAL $!bang", D: "$SET" } };
  const warnings = registerPolicyGateways(policy(gateway), { LLM_GATEWAY_KEY: "k", SET: "1" }, register).warnings;
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((w) => /TEAM/.test(w)));
  assert.ok(warnings.some((w) => /REGION/.test(w)));
});

test("against a real offline ModelRuntime: a keyed gateway is configured with the right api, an unset-key gateway is not", async () => {
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  const env = { PIST_TEST_GW_KEY: "dummy" } as NodeJS.ProcessEnv;
  delete process.env.PIST_TEST_GW_UNSET;
  process.env.PIST_TEST_GW_KEY = "dummy";
  try {
    const result = registerPolicyGateways(
      policy(
        { ...openai, id: "gw-keyed", apiKeyEnv: "PIST_TEST_GW_KEY", headers: undefined },
        { ...openai, id: "gw-anthropic", kind: "anthropic-compatible", apiKeyEnv: "PIST_TEST_GW_KEY", headers: undefined },
        { ...openai, id: "gw-unset", apiKeyEnv: "PIST_TEST_GW_UNSET", headers: undefined },
      ),
      env,
      (id, config) => runtime.registerProvider(id, config),
      runtime.getProviders().map((p) => p.id),
    );
    assert.equal(result.registered, 3);
    assert.equal(runtime.getModel("gw-keyed", "gpt-x")?.api, "openai-completions");
    assert.equal(runtime.getModel("gw-anthropic", "gpt-x")?.api, "anthropic-messages");
    assert.equal(runtime.getProviderAuthStatus("gw-keyed").configured, true);
    assert.equal(runtime.getProviderAuthStatus("gw-unset").configured, false);
  } finally {
    delete process.env.PIST_TEST_GW_KEY;
  }
});
