import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadManagedPolicy, type PolicyIo } from "./policy.ts";
import type { CommandRunner } from "./policy-mdm.ts";

// No MDM source: darwin finds no plist, win32 finds no registry value. Keeps these tests off the real machine.
const noMdm = { run: (() => ({ status: 1, stdout: "", stderr: "unable to find" })) as CommandRunner, lstat: () => null };

function io(files: Record<string, string>): PolicyIo {
  return { exists: (path) => path in files, read: (path) => files[path]! };
}
const FILE = "/p/policy.json";
const load = (text: string) => loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", io({ [FILE]: text }));

test("no policy file: null policy, no warnings, on every platform", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    assert.deepEqual(loadManagedPolicy({ ProgramData: "C:\\ProgramData" }, platform, io({}), noMdm), { policy: null, source: null, sourceKind: null, warnings: [] });
  }
});

test("platform locations are read when the env var is unset", () => {
  const darwin = "/Library/Application Support/Pista/managed-policy.json";
  const body = JSON.stringify({ version: 1, locked: { approvalMode: "read-only" } });
  assert.equal(loadManagedPolicy({}, "darwin", io({ [darwin]: body }), noMdm).source, darwin);
  assert.equal(loadManagedPolicy({}, "linux", io({ "/etc/pista/managed-policy.json": body })).policy?.locked?.approvalMode, "read-only");
  const win = loadManagedPolicy({ ProgramData: "C:\\ProgramData" }, "win32", io({ "C:\\ProgramData\\Pista\\managed-policy.json": body }), noMdm);
  assert.equal(win.policy?.locked?.approvalMode, "read-only");
});

test("PISTA_POLICY_FILE wins over the platform path, and a missing file is a warning", () => {
  const body = JSON.stringify({ version: 1 });
  const files = { "/etc/pista/managed-policy.json": body };
  const missing = loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", io(files));
  assert.equal(missing.policy, null);
  assert.match(missing.warnings[0]!, /does not exist/);
});

test("invalid JSON and wrong version are fatal and give no policy", () => {
  for (const text of ["{nope", JSON.stringify({ version: 2 }), JSON.stringify({}), "[]", "null"]) {
    const result = load(text);
    assert.equal(result.policy, null, text);
    assert.equal(result.source, null, text);
    assert.equal(result.warnings.length, 0, text);
    assert.ok(result.failure, text);
  }
});

test("unknown keys warn, bad types are dropped, the rest applies", () => {
  const result = load(
    JSON.stringify({
      version: 1,
      extra: true,
      locked: { approvalMode: "read-only", webSearchEnabled: "no", nope: 1, mcpServers: [], linkTarget: "somewhere" },
      defaults: { maxOutputTokens: 4096, instructions: "Be brief." },
    }),
  );
  assert.deepEqual(result.policy, { version: 1, locked: { approvalMode: "read-only" }, defaults: { maxOutputTokens: 4096, instructions: "Be brief." } });
  assert.equal(result.source, FILE);
  assert.equal(result.warnings.length, 5);
  for (const needle of ["extra", "locked.webSearchEnabled", "locked.nope", "locked.mcpServers", "locked.linkTarget"]) assert.ok(result.warnings.some((w) => w.includes(needle)), needle);
});

test("maxOutputTokens must be a positive integer", () => {
  assert.equal(load(JSON.stringify({ version: 1, locked: { maxOutputTokens: 0 } })).policy?.locked?.maxOutputTokens, undefined);
  assert.equal(load(JSON.stringify({ version: 1, locked: { maxOutputTokens: 1000 } })).policy?.locked?.maxOutputTokens, 1000);
});

test("nested shapes are checked and maxOutputTokens null means no cap", () => {
  const result = load(
    JSON.stringify({
      version: 1,
      locked: { defaultModel: { provider: "p" }, defaultThinkingMode: "turbo", agentRoles: { explorer: { model: { provider: "p", id: "m" } }, boss: { model: { provider: "p", id: "m" } } }, localServers: [{ id: "a" }], maxOutputTokens: null },
      defaults: { defaultModel: { provider: "p", id: "m" }, defaultThinkingMode: "high", localServers: [{ id: "a", kind: "ollama", name: "O", baseUrl: "http://127.0.0.1:11434" }] },
    }),
  );
  assert.deepEqual(Object.keys(result.policy!.locked!), ["maxOutputTokens"]);
  assert.equal(result.policy!.locked!.maxOutputTokens, undefined);
  assert.deepEqual(Object.keys(result.policy!.defaults!).sort(), ["defaultModel", "defaultThinkingMode", "localServers"]);
  assert.equal(result.warnings.length, 4);
});

test("a group- or world-writable policy file warns but still applies; the path is made absolute", () => {
  const body = JSON.stringify({ version: 1, locked: { approvalMode: "read-only" } });
  const writable = loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", { ...io({ [FILE]: body }), mode: () => 0o664 });
  assert.equal(writable.policy?.locked?.approvalMode, "read-only");
  assert.match(writable.warnings[0]!, /writable by group or others/);
  assert.deepEqual(loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", { ...io({ [FILE]: body }), mode: () => 0o644 }).warnings, []);
  const relative = loadManagedPolicy({ PISTA_POLICY_FILE: "rel.json" }, "linux", io({ [resolve("rel.json")]: body }));
  assert.equal(relative.source, resolve("rel.json"));
});

const gw = (over: Record<string, unknown> = {}) => ({
  id: "corp",
  name: "Corp Gateway",
  kind: "openai-compatible",
  baseUrl: "https://llm.example.com/v1",
  apiKeyEnv: "LLM_GATEWAY_KEY",
  models: [{ id: "gpt-x", contextWindow: 200000 }],
  ...over,
});
const loadGateways = (...list: unknown[]) => load(JSON.stringify({ version: 1, providers: { gateways: list } }));

test("a valid gateway is kept and a policy without providers has no providers key", () => {
  const ok = loadGateways(gw());
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual(ok.policy?.providers?.gateways, [gw()]);
  assert.equal("providers" in load(JSON.stringify({ version: 1 })).policy!, false);
});

test("gateways with a bad id, kind, url, key name or models are dropped with a warning", () => {
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ id: undefined }, /missing "id"/],
    [{ id: "nebius" }, /reserved/],
    [{ id: "ollama" }, /reserved/],
    [{ id: "local-lmstudio" }, /reserved/],
    [{ id: "has space" }, /may only contain/],
    [{ id: "-lead" }, /may only contain/],
    [{ baseUrl: "https://user:pw@llm.example.com/v1" }, /https/],
    [{ baseUrl: "https://llm.example.com/v1?key=1" }, /https/],
    [{ baseUrl: "https://llm.example.com/v1#frag" }, /https/],
    [{ headers: { Authorization: "!cat /etc/passwd" } }, /shell command/],
    [{ kind: "grpc" }, /kind/],
    [{ baseUrl: "http://llm.example.com/v1" }, /https/],
    [{ baseUrl: "not a url" }, /https/],
    [{ apiKeyEnv: "sk-abc def" }, /apiKeyEnv/],
    [{ apiKeyEnv: "1BAD" }, /apiKeyEnv/],
    [{ models: [] }, /no usable models/],
    [{ models: [{ name: "no id" }] }, /no usable models/],
  ];
  for (const [over, pattern] of bad) {
    const result = loadGateways(gw(over));
    assert.deepEqual(result.policy?.providers?.gateways, [], JSON.stringify(over));
    assert.ok(result.warnings.some((w) => pattern.test(w)), `${JSON.stringify(over)}: ${result.warnings.join("|")}`);
  }
});

test("http is allowed for localhost and 127.0.0.1", () => {
  for (const baseUrl of ["http://localhost:4000/v1", "http://127.0.0.1:4000/v1"]) {
    assert.equal(loadGateways(gw({ baseUrl })).policy?.providers?.gateways?.length, 1, baseUrl);
  }
});

test("a duplicate gateway id keeps the first", () => {
  const result = loadGateways(gw(), gw({ name: "Second" }));
  assert.equal(result.policy?.providers?.gateways?.length, 1);
  assert.equal(result.policy?.providers?.gateways?.[0]?.name, "Corp Gateway");
  assert.ok(result.warnings.some((w) => /duplicate id/.test(w)));
});

test("a literal-looking header secret warns but stays; $ENV references do not warn", () => {
  const literal = "x".repeat(41);
  const result = loadGateways(gw({ headers: { "X-Key": literal, "X-Env": `$${literal}`, "X-Short": "team-a" } }));
  assert.equal(result.policy?.providers?.gateways?.[0]?.headers?.["X-Key"], literal);
  assert.equal(result.warnings.filter((w) => /literal secret/.test(w)).length, 1);
  assert.match(result.warnings[0]!, /X-Key/);
});

test("bad model fields are ignored, the model stays", () => {
  const result = loadGateways(gw({ models: [{ id: "m", contextWindow: -5, maxTokens: 1.5, reasoning: true }, { id: "m" }] }));
  assert.deepEqual(result.policy?.providers?.gateways?.[0]?.models, [{ id: "m", reasoning: true }]);
  assert.equal(result.warnings.length, 3);
});

test("a malformed providers section is ignored with a warning", () => {
  for (const providers of ["x", { gateways: "x" }]) {
    const result = load(JSON.stringify({ version: 1, providers }));
    assert.equal(result.warnings.length, 1);
    assert.deepEqual(result.policy?.providers?.gateways ?? [], []);
  }
});

test("a trailing slash on baseUrl is stripped; $! at the start of a header is a literal, not a command", () => {
  const result = loadGateways(gw({ baseUrl: "https://llm.example.com/v1/", headers: { "X-Mark": "$!bang" } }));
  assert.equal(result.policy?.providers?.gateways?.[0]?.baseUrl, "https://llm.example.com/v1");
  assert.deepEqual(result.warnings, []);
});

test("an empty gateways list is accepted, a non-string header value is ignored with a warning", () => {
  assert.deepEqual(loadGateways().policy?.providers, { gateways: [] });
  const result = loadGateways(gw({ headers: { "X-Num": 5, "X-Ok": "a" } }));
  assert.deepEqual(result.policy?.providers?.gateways?.[0]?.headers, { "X-Ok": "a" });
  assert.equal(result.warnings.length, 1);
});

test("headers differing only by case, and maxTokens above contextWindow, warn", () => {
  const result = loadGateways(gw({ headers: { "X-A": "1", "x-a": "2" }, models: [{ id: "m", contextWindow: 1000, maxTokens: 2000 }] }));
  assert.equal(result.policy?.providers?.gateways?.length, 1);
  assert.ok(result.warnings.some((w) => /only by case/.test(w)));
  assert.ok(result.warnings.some((w) => /exceeds contextWindow/.test(w)));
});

test("allowlists and the login switch are kept when valid", () => {
  const { policy, warnings } = load(
    JSON.stringify({
      version: 1,
      providers: { allow: ["corp", "anthropic"], disableDirectLogin: true, gateways: [{ id: "corp", name: "Corp", kind: "openai-compatible", baseUrl: "https://llm.example.com/v1", models: [{ id: "m" }] }] },
      models: { allow: ["corp/m", "anthropic/*"] },
    }),
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(policy?.providers?.allow, ["corp", "anthropic"]);
  assert.equal(policy?.providers?.disableDirectLogin, true);
  assert.deepEqual(policy?.models?.allow, ["corp/m", "anthropic/*"]);
});

test("bad allowlist entries are dropped with a warning", () => {
  const { policy, warnings } = load(
    JSON.stringify({ version: 1, providers: { allow: ["anthropic", "", 7, " mystery "], disableDirectLogin: "yes" }, models: { allow: ["corp/m", "nope", " a/b/c ", "a/ b", 5, "p/*"], extra: 1 } }),
  );
  assert.deepEqual(policy?.providers?.allow, ["anthropic", "mystery"]);
  assert.equal(policy?.providers?.disableDirectLogin, undefined);
  assert.deepEqual(policy?.models?.allow, ["corp/m", "a/b/c", "p/*"]);
  const text = warnings.join("\n");
  assert.match(text, /providers\.allow: entry must be a non-empty string/);
  assert.match(text, /disableDirectLogin: must be a boolean/);
  assert.match(text, /models\.allow: "nope" must look like/);
  assert.match(text, /models\.allow: "a\/ b" must look like/);
  assert.match(text, /models\.extra: unknown setting/);
});

test("allow that is not an array fails closed: an empty list, with a warning", () => {
  const { policy, warnings } = load(JSON.stringify({ version: 1, providers: { allow: "corp" }, models: { allow: {} } }));
  assert.deepEqual(policy?.providers?.allow, []);
  assert.deepEqual(policy?.models?.allow, []);
  assert.equal(warnings.length, 2);
});

test("mcp: valid servers, flags and blocked names pass through", () => {
  const server = { command: "npx", args: ["-y", "srv"], env: { TOKEN: "${TOKEN}" }, exposure: "direct" };
  const { policy, warnings } = load(JSON.stringify({ version: 1, mcp: { servers: { corp: server, docs: { url: "https://d/mcp", headers: { Authorization: "Bearer ${DOCS}" } } }, allowUserServers: false, blockedServers: [" evil ", "x"] } }));
  assert.deepEqual(warnings, []);
  assert.deepEqual(policy?.mcp, { servers: { corp: server, docs: { url: "https://d/mcp", headers: { Authorization: "Bearer ${DOCS}" } } }, allowUserServers: false, blockedServers: ["evil", "x"] });
});

test("mcp: invalid servers are dropped with a warning, the rest stay", () => {
  const { policy, warnings } = load(JSON.stringify({ version: 1, mcp: { servers: {
    good: { command: "npx" },
    "bad name": { command: "npx" },
    nothing: { foo: 1 },
    badurl: { url: "ftp://x" },
    badargs: { command: "npx", args: [1] },
    badenv: { command: "npx", env: { A: 1 } },
    a_b: { command: "x" },
    "a-b": { command: "y" },
  } } }));
  assert.deepEqual(Object.keys(policy?.mcp?.servers ?? {}), ["good", "a_b"]);
  for (const name of ["bad name", "nothing", "badurl", "badargs", "badenv", "a-b"]) assert.ok(warnings.some((w) => w.startsWith(`mcp.servers.${name}:`)), name);
});

test("mcp: literal secrets in env, headers and args warn but stay; ${ENV} references do not warn", () => {
  const secret = "sk-" + "a".repeat(50);
  const { policy, warnings } = load(JSON.stringify({ version: 1, mcp: { servers: { a: { command: "x", env: { K: secret } }, b: { url: "https://b/mcp", headers: { Authorization: `Bearer ${secret}` } }, c: { command: "x", args: [secret] }, d: { command: "x", env: { K: "${" + "K}" + "x".repeat(60) } } } } }));
  assert.deepEqual(Object.keys(policy?.mcp?.servers ?? {}), ["a", "b", "c", "d"]);
  assert.deepEqual(warnings.map((w) => w.split(":")[0]), ["mcp.servers.a", "mcp.servers.b", "mcp.servers.c"]);
  assert.ok(warnings.every((w) => /literal secret/.test(w)));
});

test("mcp: bad blockedServers entries, a name both declared and blocked, and wrong types", () => {
  const both = load(JSON.stringify({ version: 1, mcp: { servers: { a: { command: "x" }, b: { command: "y" } }, blockedServers: ["a", "", 3] } }));
  assert.deepEqual(Object.keys(both.policy?.mcp?.servers ?? {}), ["b"]);
  assert.deepEqual(both.policy?.mcp?.blockedServers, ["a"]);
  assert.equal(both.warnings.filter((w) => w.startsWith("mcp.blockedServers:")).length, 2);
  assert.ok(both.warnings.some((w) => w.includes("mcp.servers.a: also in mcp.blockedServers")));
  const wrong = load(JSON.stringify({ version: 1, mcp: { servers: [], allowUserServers: "no", blockedServers: "x", extra: 1 } }));
  assert.equal(wrong.policy?.mcp?.allowUserServers, undefined);
  assert.equal(wrong.warnings.length, 4);
  assert.equal(load(JSON.stringify({ version: 1, mcp: [] })).policy?.mcp, undefined);
});

test("mcp: values Pi would reject (exposure, enabled, timeout, description, toolExposure, type sse) drop the server", () => {
  const bad = {
    exp: { command: "x", exposure: "everywhere" },
    en: { command: "x", enabled: "yes" },
    to: { command: "x", timeout: 0 },
    de: { command: "x", description: 3 },
    te: { command: "x", toolExposure: { a: "loud" } },
    sse: { url: "https://s/sse", type: "sse" },
    ok: { url: "https://s/mcp", type: "streamable-http", toolExposure: { "get_*": "direct" }, exposure: "hidden", enabled: false, timeout: 30, description: "d" },
  };
  const { policy, warnings } = load(JSON.stringify({ version: 1, mcp: { servers: bad } }));
  assert.deepEqual(Object.keys(policy?.mcp?.servers ?? {}), ["ok"]);
  for (const name of ["exp", "en", "to", "de", "te", "sse"]) assert.ok(warnings.some((w) => w.startsWith(`mcp.servers.${name}:`)), name);
  assert.ok(warnings.some((w) => w.includes("exposure")));
});

test("mcp: prototype-polluting names are rejected; paths and URLs are not flagged as secrets", () => {
  const json = '{"version":1,"mcp":{"servers":{"__proto__":{"command":"x"},"constructor":{"command":"x"},"ok":{"command":"x","args":["/usr/local/lib/some/very/long/path/that/goes/past/forty/characters.js","https://example.com/a/very/long/url/past/forty/characters"],"env":{"H":"~/a/very/long/home/relative/path/past/forty/chars"}}}}}';
  const { policy, warnings } = load(json);
  assert.deepEqual(Object.keys(policy?.mcp?.servers ?? {}), ["ok"]);
  assert.deepEqual(warnings.map((w) => w.split(":")[0]), ["mcp.servers.__proto__", "mcp.servers.constructor"]);
});

test("mcp: mcpUntrusted marks a failed load and a malformed mcp section, not a missing default file", () => {
  assert.equal(load("{nope").mcpUntrusted, true);
  assert.equal(load(JSON.stringify({ version: 2 })).mcpUntrusted, true);
  assert.equal(loadManagedPolicy({ PISTA_POLICY_FILE: "/nope.json" }, "linux", io({})).mcpUntrusted, true);
  assert.equal(loadManagedPolicy({}, "linux", io({})).mcpUntrusted, undefined);
  for (const mcp of [[], { servers: [] }, { blockedServers: "x" }]) assert.equal(load(JSON.stringify({ version: 1, mcp })).mcpUntrusted, true, JSON.stringify(mcp));
  assert.equal(load(JSON.stringify({ version: 1, mcp: { servers: { a: { command: "x" } } } })).mcpUntrusted, undefined);
  assert.equal(load(JSON.stringify({ version: 1 })).mcpUntrusted, undefined);
});

const oidc = { type: "oidc", issuer: "https://idp.example.com/oauth2/default", clientId: "pista-client" };
const ssoGw = (over: Record<string, unknown> = {}) => gw({ apiKeyEnv: undefined, auth: oidc, ...over });

test("an SSO gateway keeps its auth block with the default scopes merged and deduplicated", () => {
  const result = loadGateways(ssoGw({ auth: { ...oidc, scopes: ["profile", "openid"], token: "id", audience: "api://corp" } }));
  assert.deepEqual(result.warnings, []);
  const gateway = result.policy?.providers?.gateways?.[0];
  assert.deepEqual(gateway?.auth, { ...oidc, scopes: ["openid", "offline_access", "profile"], token: "id", audience: "api://corp" });
  assert.equal("apiKeyEnv" in gateway!, false);
  assert.deepEqual(loadGateways(ssoGw()).policy?.providers?.gateways?.[0]?.auth?.scopes, ["openid", "offline_access"]);
});

test("a bad auth block, or auth together with apiKeyEnv, drops the gateway with a warning", () => {
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ apiKeyEnv: "LLM_GATEWAY_KEY" }, /mutually exclusive/],
    [{ auth: { ...oidc, type: "saml" } }, /auth\.type/],
    [{ auth: { ...oidc, issuer: "http://idp.example.com" } }, /auth\.issuer/],
    [{ auth: { ...oidc, issuer: "https://u:p@idp.example.com" } }, /auth\.issuer/],
    [{ auth: { ...oidc, issuer: "https://idp.example.com/?x=1" } }, /auth\.issuer/],
    [{ auth: { ...oidc, issuer: "https://idp.example.com/#f" } }, /auth\.issuer/],
    [{ auth: { ...oidc, clientId: " " } }, /clientId/],
    [{ auth: { ...oidc, scopes: ["ok", ""] } }, /scopes/],
    [{ auth: { ...oidc, scopes: "openid" } }, /scopes/],
    [{ auth: { ...oidc, token: "refresh" } }, /auth\.token/],
    [{ auth: { ...oidc, audience: 3 } }, /audience/],
  ];
  for (const [over, pattern] of bad) {
    const result = loadGateways(ssoGw(over));
    assert.deepEqual(result.policy?.providers?.gateways, [], JSON.stringify(over));
    assert.ok(result.warnings.some((w) => pattern.test(w)), `${JSON.stringify(over)}: ${result.warnings.join("|")}`);
  }
});

// Strict blocks: any unknown key or wrong-typed value stops the host.
const STRICT_BLOCKS: Array<[string, Record<string, unknown>]> = [
  ["network", { proxy: 1 }],
  ["telemetry", { piTelemetry: "yes" }],
  ["browser", { allowedDomains: "example.com" }],
  ["updates", { enabled: "yes" }],
  ["retention", { sessionDays: "7" }],
  ["policySource", { url: 1 }],
];

for (const [name, wrongType] of STRICT_BLOCKS) {
  test(`strict block ${name}: unknown key, wrong type and non-object are fatal`, () => {
    for (const [value, pattern] of [
      [{ nope: 1 }, new RegExp(`${name}\\.nope: unknown setting`)],
      [wrongType, new RegExp(`${name}\\.${Object.keys(wrongType)[0]}`)],
      [[], new RegExp(`"${name}" must be an object`)],
    ] as const) {
      const result = load(JSON.stringify({ version: 1, [name]: value }));
      assert.ok(result.failure, `${name}: ${JSON.stringify(value)} should be fatal`);
      assert.match(result.failure!, pattern);
    }
  });
}

test("modelTiers and tier: role models are validated", () => {
  const good = { cheap: { provider: "p", id: "m" }, "local-2": { provider: "lmstudio", id: "x" } };
  const ok = load(JSON.stringify({ version: 1, locked: { modelTiers: good, agentOverrides: { explorer: { model: "tier:cheap" } }, agentRoles: { reviewer: { model: "tier:strong" } } } }));
  assert.deepEqual(ok.policy?.locked?.modelTiers, good);
  assert.deepEqual(Object.keys(ok.policy!.locked!).sort(), ["agentOverrides", "agentRoles", "modelTiers"]);
  for (const bad of [{ Cheap: { provider: "p", id: "m" } }, { cheap: { provider: "", id: "m" } }, { cheap: { provider: "p" } }, { cheap: "p/m" }, { cheap: "tier:x" }, [{ provider: "p", id: "m" }]]) {
    assert.equal(load(JSON.stringify({ version: 1, locked: { modelTiers: bad } })).policy?.locked?.modelTiers, undefined, JSON.stringify(bad));
  }
  assert.equal(load(JSON.stringify({ version: 1, locked: { agentOverrides: { explorer: { model: "tier:Bad Name" } } } })).policy?.locked?.agentOverrides, undefined);
  assert.equal(load(JSON.stringify({ version: 1, locked: { agentRoles: { reviewer: { model: "tier:Bad Name" } } } })).policy?.locked?.agentRoles, undefined);
});

test("sliced settings are validated", () => {
  const locked = (sliced: unknown) => load(JSON.stringify({ version: 1, locked: { orchestratorMode: "sliced", sliced } })).policy?.locked;
  assert.equal(locked({})?.orchestratorMode, "sliced");
  const good = { minSlices: 2, maxParallel: 3, integrateTools: "read-only", repoSizeFraction: 0.25 };
  assert.deepEqual(locked(good)?.sliced, good);
  for (const bad of [{ minSlices: 0 }, { minSlices: 1.5 }, { maxParallel: 4 }, { maxParallel: 0 }, { integrateTools: "none" }, { repoSizeFraction: 0 }, { repoSizeFraction: 1.1 }, { other: 1 }, [], "x"]) {
    assert.equal(locked(bad)?.sliced, undefined, JSON.stringify(bad));
  }
});
