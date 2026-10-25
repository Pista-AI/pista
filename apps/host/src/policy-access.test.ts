import assert from "node:assert/strict";
import { test } from "node:test";
import type { ManagedPolicy } from "@pista/protocol";
import { accessSummary, describeDenied, isDirectLoginAllowed, isModelAllowed, isProviderAllowed, pickAllowedModel, unknownAllowedProviders } from "./policy-access.ts";

const policy = (extra: Omit<ManagedPolicy, "version">): ManagedPolicy => ({ version: 1, ...extra });

test("no policy, or a policy without allowlists, allows everything", () => {
  for (const p of [null, undefined, policy({}), policy({ providers: {}, models: {} })]) {
    assert.ok(isProviderAllowed(p, "anthropic"));
    assert.ok(isModelAllowed(p, { provider: "anthropic", id: "x" }));
    assert.ok(isDirectLoginAllowed(p, "anthropic"));
    assert.equal(accessSummary(p), "");
  }
});

test("providers.allow limits providers and therefore their models", () => {
  const p = policy({ providers: { allow: ["corp"] } });
  assert.ok(isProviderAllowed(p, "corp"));
  assert.ok(!isProviderAllowed(p, "anthropic"));
  assert.ok(isModelAllowed(p, { provider: "corp", id: "any" }));
  assert.ok(!isModelAllowed(p, { provider: "anthropic", id: "claude" }));
  assert.ok(!isDirectLoginAllowed(p, "anthropic"));
  assert.ok(isDirectLoginAllowed(p, "corp"));
});

test("models.allow matches exact ids and provider wildcards", () => {
  const p = policy({ models: { allow: ["corp/fast", "openai/*"] } });
  assert.ok(isModelAllowed(p, { provider: "corp", id: "fast" }));
  assert.ok(!isModelAllowed(p, { provider: "corp", id: "slow" }));
  assert.ok(isModelAllowed(p, { provider: "openai", id: "gpt-9" }));
  assert.ok(!isModelAllowed(p, { provider: "google", id: "gemini" }));
});

test("both lists apply together: the provider must be allowed and the model must match", () => {
  const p = policy({ providers: { allow: ["corp"] }, models: { allow: ["corp/fast", "openai/*"] } });
  assert.ok(isModelAllowed(p, { provider: "corp", id: "fast" }));
  assert.ok(!isModelAllowed(p, { provider: "corp", id: "slow" }));
  assert.ok(!isModelAllowed(p, { provider: "openai", id: "gpt-9" }));
});

test("an empty allowlist denies everything", () => {
  assert.ok(!isProviderAllowed(policy({ providers: { allow: [] } }), "corp"));
  assert.ok(!isModelAllowed(policy({ models: { allow: [] } }), { provider: "corp", id: "x" }));
});

test("disableDirectLogin blocks login for every provider", () => {
  const p = policy({ providers: { disableDirectLogin: true } });
  assert.ok(!isDirectLoginAllowed(p, "anthropic"));
  assert.ok(isProviderAllowed(p, "anthropic"));
});

test("error text and startup summary", () => {
  assert.equal(describeDenied({ provider: "a", id: "b" }), "Not allowed by your organisation's policy: a/b");
  const p = policy({ providers: { allow: ["corp"], disableDirectLogin: true }, models: { allow: ["corp/a", "corp/b"] } });
  assert.equal(accessSummary(p), ", allow 1 providers / 2 models, direct login off");
  assert.equal(accessSummary(policy({ providers: { disableDirectLogin: true } })), ", allow all providers / all models, direct login off");
});

test("pickAllowedModel keeps an allowed preference, else takes the first allowed, else throws", () => {
  const available = [{ provider: "anthropic", id: "a" }, { provider: "corp", id: "m1" }, { provider: "corp", id: "m2" }];
  const p = policy({ providers: { allow: ["corp"] } });
  assert.deepEqual(pickAllowedModel(p, available, { provider: "corp", id: "m2" }), { provider: "corp", id: "m2" });
  assert.deepEqual(pickAllowedModel(p, available, { provider: "anthropic", id: "a" }), { provider: "corp", id: "m1" });
  assert.deepEqual(pickAllowedModel(p, available, undefined), { provider: "corp", id: "m1" });
  assert.throws(() => pickAllowedModel(policy({ providers: { allow: ["nobody"] } }), available, { provider: "anthropic", id: "a" }), /Not allowed by your organisation's policy: anthropic\/a/);
  const preferred = { provider: "anthropic", id: "a" };
  assert.equal(pickAllowedModel(null, available, preferred), preferred);
});

test("auth.login is rejected before touching the runtime when login is disabled or the provider is not allowed", async () => {
  const { login } = await import("./auth.ts");
  const untouched = new Proxy({}, { get: () => assert.fail("runtime must not be used") });
  await assert.rejects(login(untouched as never, untouched as never, "anthropic", "api_key", "d", "k", policy({ providers: { disableDirectLogin: true } })), /disabled by your organisation's policy/);
  await assert.rejects(login(untouched as never, untouched as never, "anthropic", "oauth", "d", undefined, policy({ providers: { allow: ["corp"] } })), /Not allowed by your organisation's policy: anthropic/);
});

test("allowed provider ids that nothing registers are reported but not removed", () => {
  const p = policy({ providers: { allow: ["anthropic", "mystery"] } });
  assert.deepEqual(unknownAllowedProviders(p, ["anthropic", "corp"]), ['providers.allow: "mystery" is neither a built-in provider nor a declared gateway']);
  assert.deepEqual(unknownAllowedProviders(null, []), []);
});

test("fallback order: gateway models first in policy order, then the rest sorted by provider/id", () => {
  const p = policy({ providers: { gateways: [{ id: "g2", name: "", kind: "openai-compatible", baseUrl: "", models: [] }, { id: "g1", name: "", kind: "openai-compatible", baseUrl: "", models: [] }], allow: ["g1", "g2", "zeta", "alpha"] } });
  const available = [{ provider: "zeta", id: "z" }, { provider: "g1", id: "b" }, { provider: "alpha", id: "a" }, { provider: "g2", id: "x" }, { provider: "g1", id: "a" }];
  assert.deepEqual(pickAllowedModel(p, available, undefined), { provider: "g2", id: "x" });
  assert.deepEqual(pickAllowedModel(policy({ providers: { allow: ["zeta", "alpha"] } }), available, undefined), { provider: "alpha", id: "a" });
});

test("pickAllowedModel tells 'nothing allowed' from 'allowed but not configured'", () => {
  const gw = { id: "gw", name: "", kind: "openai-compatible" as const, baseUrl: "", apiKeyEnv: "GW_KEY", models: [] };
  const registered = [{ provider: "gw", id: "m" }, { provider: "anthropic", id: "a" }];
  const p = policy({ providers: { allow: ["gw"], gateways: [gw] } });
  assert.throws(() => pickAllowedModel(p, [{ provider: "anthropic", id: "a" }], undefined, registered), /^Error: No allowed model is configured; set GW_KEY$/);
  const noEnv = policy({ providers: { allow: ["gw"], gateways: [{ ...gw, apiKeyEnv: undefined }] } });
  assert.throws(() => pickAllowedModel(noEnv, [], undefined, registered), /^Error: No allowed model is configured$/);
  assert.throws(() => pickAllowedModel(policy({ providers: { allow: ["nobody"] } }), [], { provider: "anthropic", id: "a" }, registered), /Not allowed by your organisation's policy: anthropic\/a/);
});

test("allowing local or llama providers does not draw an unknown-provider warning", () => {
  const p = policy({ providers: { allow: ["lmstudio", "ollama", "llama.cpp", "local-8080", "typo"] } });
  assert.equal(unknownAllowedProviders(p, ["anthropic"]).length, 1);
});

// A runtime with only the parts listModels and listProviders read.
function fakeRuntime(opts: { available: Array<{ provider: string; id: string }>; providers: string[]; configured?: string[] }) {
  return {
    getAvailable: async () => opts.available.map((m) => ({ ...m, name: m.id, reasoning: false, contextWindow: 1000 })),
    getProviders: () => opts.providers.map((id) => ({ id, name: id, auth: { apiKey: { login: () => {} }, oauth: id === "anthropic" ? {} : undefined } })),
    getProviderAuthStatus: (id: string) => ({ configured: (opts.configured ?? []).includes(id) }),
    isUsingOAuth: () => false,
  } as never;
}

test("listModels keeps only allowed models", async () => {
  const { listModels } = await import("./auth.ts");
  const runtime = fakeRuntime({ available: [{ provider: "corp", id: "a" }, { provider: "corp", id: "b" }, { provider: "anthropic", id: "c" }], providers: [] });
  assert.deepEqual((await listModels(runtime, policy({ models: { allow: ["corp/a"] } }))).map((m) => `${m.provider}/${m.id}`), ["corp/a"]);
  assert.deepEqual((await listModels(runtime, policy({ providers: { allow: ["corp"] } }))).map((m) => m.id), ["a", "b"]);
  assert.equal((await listModels(runtime, null)).length, 3);
});

test("listProviders filters by providers.allow and offers no sign-in when direct login is off", async () => {
  const { listProviders } = await import("./auth.ts");
  const runtime = fakeRuntime({ available: [], providers: ["anthropic", "corp"], configured: ["corp"] });
  assert.deepEqual(listProviders(runtime, null).map((p) => [p.id, p.authTypes]), [["corp", ["api_key"]], ["anthropic", ["api_key", "oauth"]]]);
  assert.deepEqual(listProviders(runtime, policy({ providers: { allow: ["corp"] } })).map((p) => p.id), ["corp"]);
  assert.deepEqual(listProviders(runtime, policy({ providers: { disableDirectLogin: true } })).map((p) => [p.id, p.authTypes]), [["corp", []], ["anthropic", []]]);
});

const ssoPolicy = (extra: NonNullable<ManagedPolicy["providers"]> = {}) =>
  policy({
    providers: {
      gateways: [
        { id: "corp-sso", name: "Corp SSO", kind: "openai-compatible", baseUrl: "https://llm.example.com/v1", auth: { type: "oidc", issuer: "https://idp.example.com", clientId: "c" }, models: [{ id: "m" }] },
        { id: "corp-key", name: "Corp Key", kind: "openai-compatible", baseUrl: "https://llm.example.com/v1", apiKeyEnv: "K", models: [{ id: "m" }] },
      ],
      disableDirectLogin: true,
      ...extra,
    },
  });

test("disableDirectLogin still allows OAuth sign-in to a policy SSO gateway, and nothing else", () => {
  const p = ssoPolicy();
  assert.ok(isDirectLoginAllowed(p, "corp-sso"));
  assert.ok(isDirectLoginAllowed(p, "corp-sso", "oauth"));
  assert.ok(!isDirectLoginAllowed(p, "corp-sso", "api_key"));
  assert.ok(!isDirectLoginAllowed(p, "corp-key"));
  assert.ok(!isDirectLoginAllowed(p, "anthropic"));
  assert.ok(!isDirectLoginAllowed(p, "anthropic", "oauth"));
  assert.ok(!isDirectLoginAllowed(ssoPolicy({ allow: ["corp-key"] }), "corp-sso"));
});

test("listProviders marks SSO gateways and keeps their oauth sign-in when direct login is off", async () => {
  const { listProviders } = await import("./auth.ts");
  const runtime = {
    getProviders: () => [
      { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: () => {} }, oauth: {} } },
      { id: "corp-key", name: "Corp Key", auth: { apiKey: { login: () => {} } } },
      { id: "corp-sso", name: "Corp SSO", auth: { oauth: {} } },
    ],
    getProviderAuthStatus: () => ({ configured: false }),
    isUsingOAuth: () => false,
  } as never;
  const rows = listProviders(runtime, ssoPolicy());
  assert.deepEqual(rows.map((p) => [p.id, p.authTypes, p.sso]), [["anthropic", [], undefined], ["corp-key", [], undefined], ["corp-sso", ["oauth"], true]]);
  assert.deepEqual(listProviders(runtime, ssoPolicy({ disableDirectLogin: false })).find((p) => p.id === "corp-sso")?.authTypes, ["oauth"]);
});

test("pickAllowedModel names the SSO gateway to sign in to when nothing is configured", () => {
  const p = ssoPolicy({ allow: ["corp-sso"] });
  assert.throws(() => pickAllowedModel(p, [], undefined, [{ provider: "corp-sso", id: "m" }]), /sign in to Corp SSO/);
});
