import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

// CLIENT_DIR and the agent dir are read when the modules load, so set them first and import dynamically.
const { home, agentDir } = setupHome("mcp-config");
// pi-env defaults PI_MEMORY_DIR at load; a value exported in the shell would make the default test below fail.
delete process.env.PI_MEMORY_DIR;
const { convertLegacy, validateServers, McpFile } = await import("./mcp-config.ts");
const { ConfigStore } = await import("./config.ts");
const { migratePiState, migratePiMemory } = await import("./pi-env.ts");
const { memoryDir } = await import("./memory.ts");

test("convertLegacy: tokenEnvVar becomes a ${VAR} bearer header, with exposure and description", () => {
  assert.deepEqual(convertLegacy({ name: "acme", url: "https://a.example/mcp", tokenEnvVar: "ACME_TOKEN", token: "ignored", exposure: "direct", description: "CRM" }), {
    name: "acme",
    transport: "http",
    url: "https://a.example/mcp",
    headers: { Authorization: "Bearer ${ACME_TOKEN}" },
    exposure: "direct",
    description: "CRM",
  });
});

test("convertLegacy: a literal token stays a literal header, no token means no headers, unusable entries are dropped", () => {
  assert.deepEqual((convertLegacy({ name: "a", url: "https://a/mcp", token: "s3cret", exposure: "deferred" }) as { headers?: unknown }).headers, { Authorization: "Bearer s3cret" });
  assert.equal("headers" in convertLegacy({ name: "b", url: "https://b/mcp", tokenEnvVar: "", token: "" })!, false);
  assert.equal(convertLegacy({ name: "", url: "https://x" }), undefined);
  assert.equal(convertLegacy({ name: "x", url: "" }), undefined);
});

test("first start moves config.json mcpServers into mcp.json (0600) and removes them from config.json", () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ config: { mcpServers: [{ name: "acme", url: "https://a.example/mcp", tokenEnvVar: "ACME_TOKEN", token: "", exposure: "direct", description: "" }] } }),
  );
  const store = new ConfigStore();
  assert.deepEqual(store.config.mcpServers, [{ name: "acme", transport: "http", url: "https://a.example/mcp", headers: { Authorization: "Bearer ${ACME_TOKEN}" }, exposure: "direct" }]);
  const file = join(agentDir, "mcp.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).mcpServers.acme, { url: "https://a.example/mcp", headers: { Authorization: "Bearer ${ACME_TOKEN}" }, exposure: "direct" });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal("mcpServers" in JSON.parse(readFileSync(join(home, "config.json"), "utf8")).config, false);
  // A second start reads the same servers from mcp.json.
  assert.equal(new ConfigStore().config.mcpServers.length, 1);
});

test("config.set writes mcp.json, keeps OAuth settings of kept servers, and rejects invalid entries", () => {
  const store = new ConfigStore();
  const file = join(agentDir, "mcp.json");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  doc.mcpServers.acme.oauth = { clientId: "abc" };
  doc.mcpServers.acme.type = "streamable-http";
  writeFileSync(file, JSON.stringify(doc));

  store.patchConfig({ mcpServers: [...store.config.mcpServers, { name: "files", transport: "stdio", command: "npx", args: ["-y", "srv", "."], env: { KEY: "${KEY}" } }] });
  const saved = JSON.parse(readFileSync(file, "utf8")).mcpServers;
  assert.deepEqual(saved.acme.oauth, { clientId: "abc" });
  assert.equal(saved.acme.type, "streamable-http", "a hand-written type survives a UI save");
  assert.deepEqual(saved.files, { command: "npx", args: ["-y", "srv", "."], env: { KEY: "${KEY}" } });

  const bad = [
    { name: "has space", transport: "http", url: "https://x" },
    { name: "a", transport: "http", url: "ftp://x" },
    { name: "a", transport: "stdio", command: " " },
  ];
  for (const entry of bad) assert.throws(() => store.patchConfig({ mcpServers: [entry] as never }), JSON.stringify(entry));
  assert.ok(validateServers([{ name: "a-b", transport: "http", url: "https://x" }, { name: "a_b", transport: "http", url: "https://x" }]), "- and _ count as one name");
  assert.equal(store.config.mcpServers.length, 2, "invalid patches leave mcp.json untouched");
});

test("McpFile.list ignores a missing or broken file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-mcpfile-"));
  assert.deepEqual(new McpFile(join(dir, "none.json")).list(), []);
  writeFileSync(join(dir, "bad.json"), "{nope");
  assert.deepEqual(new McpFile(join(dir, "bad.json")).list(), []);
});

test("migratePiState copies sessions and MCP state, leaves the source alone, and records where from", () => {
  const root = mkdtempSync(join(tmpdir(), "pista-migrate-"));
  const from = join(root, "from");
  const to = join(root, "to");
  mkdirSync(join(from, "sessions", "--proj--"), { recursive: true });
  mkdirSync(to);
  writeFileSync(join(from, "sessions", "--proj--", "s.jsonl"), "{}\n");
  writeFileSync(join(from, "mcp-auth.json"), "{}");
  writeFileSync(join(from, "other.txt"), "x");
  const copied = migratePiState(from, to);
  assert.deepEqual(copied.sort(), ["mcp-auth.json", "sessions"]);
  assert.ok(existsSync(join(to, "sessions", "--proj--", "s.jsonl")));
  assert.ok(existsSync(join(from, "sessions", "--proj--", "s.jsonl")));
  assert.equal(existsSync(join(to, "other.txt")), false);
  assert.equal(readFileSync(join(to, ".migrated-from"), "utf8").trim(), from);
});

test("migratePiMemory copies the memory dir once and never overwrites an existing target", () => {
  const root = mkdtempSync(join(tmpdir(), "pista-memory-migrate-"));
  const from = join(root, "from");
  const to = join(root, "to");
  mkdirSync(join(from, "daily"), { recursive: true });
  writeFileSync(join(from, "MEMORY.md"), "long term");
  writeFileSync(join(from, "daily", "2026-10-10.md"), "day");
  assert.equal(migratePiMemory(from, to), true);
  assert.equal(readFileSync(join(to, "MEMORY.md"), "utf8"), "long term");
  assert.ok(existsSync(join(to, "daily", "2026-10-10.md")));
  assert.ok(existsSync(join(from, "MEMORY.md")), "source is left alone");
  writeFileSync(join(to, "MEMORY.md"), "newer");
  assert.equal(migratePiMemory(from, to), false);
  assert.equal(readFileSync(join(to, "MEMORY.md"), "utf8"), "newer");
  assert.equal(migratePiMemory(join(root, "missing"), join(root, "other")), false);
});

test("memoryDir defaults to the agent dir's memory folder and PI_MEMORY_DIR overrides it", () => {
  assert.equal(memoryDir(), join(agentDir, "memory"));
  const previous = process.env.PI_MEMORY_DIR;
  process.env.PI_MEMORY_DIR = join(home, "elsewhere");
  try {
    assert.equal(memoryDir(), join(home, "elsewhere"));
  } finally {
    if (previous === undefined) delete process.env.PI_MEMORY_DIR;
    else process.env.PI_MEMORY_DIR = previous;
  }
});

test("McpFile rules: managed servers are read-only, blocked names cannot be added, additions can be switched off", () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-mcprules-"));
  const mcp = new McpFile(join(dir, "mcp.json"));
  const corp = { name: "corp", transport: "http", url: "https://c/mcp" } as const;
  const mine = { name: "mine", transport: "stdio", command: "npx" } as const;
  mcp.set([corp, mine]);
  mcp.rules = { managed: ["corp"], blocked: ["bad-one"], allowUserServers: true };
  const denied = (servers: Parameters<typeof mcp.set>[0], text: RegExp) => assert.throws(() => mcp.set(servers), text);
  denied([mine], /Not allowed by your organisation's policy: removing the managed MCP server "corp"/);
  denied([{ ...corp, url: "https://other/mcp" }, mine], /changing the managed MCP server "corp"/);
  denied([corp, mine, { name: "bad_one", transport: "http", url: "https://b/mcp" }], /"bad_one" is blocked/);
  mcp.set([corp, { ...mine, command: "uvx" }, { name: "second", transport: "http", url: "https://s/mcp" }]); // allowed: edit and add
  assert.deepEqual(mcp.list().map((s) => s.name).sort(), ["corp", "mine", "second"]);
  mcp.rules = { managed: ["corp"], blocked: [], allowUserServers: false };
  denied([...mcp.list(), { name: "third", transport: "http", url: "https://t/mcp" }], /adding the MCP server "third"/);
  mcp.set(mcp.list().filter((s) => s.name !== "second").map((s) => (s.name === "mine" ? { ...s, command: "node" } : s))); // edit and remove stay allowed
  assert.deepEqual(mcp.list().map((s) => s.name).sort(), ["corp", "mine"]);
});
