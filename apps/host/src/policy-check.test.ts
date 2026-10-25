import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadManagedPolicy } from "./policy.ts";
import { checkPolicy, redactPolicy, runPolicyCheck } from "./policy-check.ts";

const FILE = "/p/policy.json";
const run = (body: unknown, env: NodeJS.ProcessEnv = {}) => {
  const files: Record<string, string> = body === undefined ? {} : { [FILE]: typeof body === "string" ? body : JSON.stringify(body) };
  const loaded = loadManagedPolicy({ PISTA_POLICY_FILE: FILE, ...env }, "linux", { exists: (p) => p in files, read: (p) => files[p]! });
  return { loaded, result: checkPolicy(loaded, { PISTA_POLICY_FILE: FILE, ...env }, "linux", (p) => p in files) };
};

test("valid policy: exit 0, effective values present, secrets redacted", () => {
  const { result } = run({
    version: 1,
    locked: { approvalMode: "read-only" },
    defaults: { webSearchEnabled: false },
    providers: { gateways: [{ id: "corp", name: "Corp", kind: "openai-compatible", baseUrl: "https://gw.example.com", headers: { Authorization: "Bearer topsecret" }, apiKeyEnv: "CORP_KEY", models: [{ id: "m" }] }] },
    network: { proxy: "http://user:hunter2@proxy.example.com:8080" },
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "ok");
  assert.equal(result.source, FILE);
  assert.equal(result.sourceKind, "env-file");
  const text = JSON.stringify(result);
  assert.match(text, /read-only/);
  assert.doesNotMatch(text, /topsecret|hunter2/);
  assert.match(text, /CORP_KEY/);
  assert.match(text, /proxy\.example\.com/);
});

test("invalid policy and required-but-missing policy are fatal (exit 1)", () => {
  const bad = run({ version: 2 }).result;
  assert.equal(bad.exitCode, 1);
  assert.ok(bad.fatal.length > 0);
  assert.equal(bad.source, FILE);
  assert.deepEqual(bad.warnings, []);
  const missing = run(undefined, { PISTA_REQUIRE_POLICY: "1" }).result;
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.status, "fatal");
  assert.equal(missing.source, null);
});

test("an unreadable CA file is fatal", () => {
  const { result } = run({ version: 1, network: { caCertFiles: ["/nonexistent/ca.pem"] } });
  assert.equal(result.exitCode, 1);
  assert.match(result.fatal[0]!, /caCertFiles/);
});

test("a readable file that is not a PEM certificate is fatal", () => {
  const file = join(mkdtempSync(join(tmpdir(), "pista-ca-")), "ca.pem");
  writeFileSync(file, "not a certificate");
  assert.equal(run({ version: 1, network: { caCertFiles: [file] } }).result.exitCode, 1);
  writeFileSync(file, "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n");
  assert.equal(run({ version: 1, network: { caCertFiles: [file] } }).result.exitCode, 1);
});

test("redacts mcp args after secret flags, --flag=value forms and URL query strings", () => {
  const out = redactPolicy({ mcp: { servers: { s: { command: "npx", args: ["-y", "srv", "--token", "abc", "--api-key=xyz", "--port", "80", "https://h.example.com/p?key=1&x=2"] } } } });
  assert.deepEqual((out.mcp.servers.s as { args: string[] }).args, ["-y", "srv", "--token", "***", "--api-key=***", "--port", "80", "https://h.example.com/p?***"]);
});

test("warnings only: exit 2", () => {
  const { result } = run({ version: 1, surprise: true });
  assert.equal(result.exitCode, 2);
  assert.equal(result.status, "warnings");
  assert.ok(result.warnings.length > 0);
});

test("redaction is generic: unknown blocks, env maps, secret-looking keys and URL credentials", () => {
  const out = redactPolicy({ audit: { sink: "https://u:p@collector.example.com/x", authToken: "abc", env: { A: "b" }, tokenEnv: "TOK", list: [{ headers: { X: "y" } }] } });
  assert.deepEqual(out, { audit: { sink: "https://***@collector.example.com/x", authToken: "***", env: { A: "***" }, tokenEnv: "TOK", list: [{ headers: { X: "***" } }] } });
});

test("secret keys match the whole key or its last segment, not words that merely contain one", () => {
  const out = redactPolicy({ maxOutputTokens: 4096, maxTokens: 10, authToken: "a", api_key: "b", Authorization: "c", clientSecret: "d" }) as Record<string, unknown>;
  assert.deepEqual(out, { maxOutputTokens: 4096, maxTokens: 10, authToken: "***", api_key: "***", Authorization: "***", clientSecret: "***" });
});

test("runPolicyCheck: --json parses, unknown subcommand is usage (64)", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const sink = { log: (t: string) => out.push(t), error: (t: string) => err.push(t) };
  assert.equal(await runPolicyCheck(["policy", "check", "--json"], { PISTA_POLICY_FILE: "/nonexistent/none.json" }, sink), 2);
  assert.equal(JSON.parse(out[0]!).status, "warnings");
  assert.equal(await runPolicyCheck(["policy", "check"], { PISTA_POLICY_FILE: "/nonexistent/none.json" }, sink), 2);
  assert.match(out[1]!, /^Policy source: none\nStatus: warnings \(exit 2\)/);
  assert.equal(await runPolicyCheck(["policy", "nope"], {}, sink), 64);
  assert.match(err[0]!, /Usage/);
});

test("audit.headersEnv names are not masked, and an unset variable is a warning", () => {
  const body = { version: 1, audit: { otlpEndpoint: "https://otel.example.com", headersEnv: { authorization: "OTEL_AUTH", "x-api-key": "OTEL_KEY" } } };
  const { result } = run(body, { OTEL_AUTH: "v" });
  assert.deepEqual((result.effective as any).audit.headersEnv, { authorization: "OTEL_AUTH", "x-api-key": "OTEL_KEY" });
  assert.equal(result.status, "warnings");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /OTEL_KEY is not set/);
  assert.equal(run(body, { OTEL_AUTH: "v", OTEL_KEY: "k" }).result.status, "ok");
});
