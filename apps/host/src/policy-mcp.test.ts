import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ManagedPolicy } from "@pista/protocol";
import { setupHome } from "./test-helpers.ts";

const { home, agentDir } = setupHome("policy-mcp");
const { reconcileMcp, describeMcp } = await import("./policy-mcp.ts");
const { ConfigStore } = await import("./config.ts");

const server = { command: "npx", args: ["-y", "srv"], env: { TOKEN: "${TOKEN}" } };
const file = join(agentDir, "mcp.json");
const read = () => JSON.parse(readFileSync(file, "utf8")).mcpServers;
const policy = (mcp: NonNullable<ManagedPolicy["mcp"]>) => ({ policy: { version: 1, mcp } as ManagedPolicy, source: "test", sourceKind: null, warnings: [] as string[] });
const reset = () => {
  for (const f of [file, join(home, "config.json")]) rmSync(f, { force: true });
};

test("reconcileMcp: adds policy servers, replaces a same-name user entry in place, keeps other user servers", () => {
  const current = { mine: { url: "https://m/mcp" }, corp: { url: "https://user-copy/mcp" }, other: { command: "x" } };
  const out = reconcileMcp(current, { servers: { corp: server, extra: { url: "https://e/mcp" } } }, []);
  assert.deepEqual(Object.keys(out.servers), ["mine", "corp", "other", "extra"]);
  assert.deepEqual(out.servers.corp, server);
  assert.deepEqual(out.managed, ["corp", "extra"]);
  assert.equal(out.changed, true);
});

test("reconcileMcp: removes previously managed servers and blocked names (- and _ are one name), blocked beats managed", () => {
  const current = { old: server, mine: { url: "https://m/mcp" }, "bad-one": { command: "x" }, kept: { command: "y" } };
  const out = reconcileMcp(current, { servers: { fresh: server, bad_one: server }, blockedServers: ["bad_one"] }, ["old"]);
  assert.deepEqual(Object.keys(out.servers), ["mine", "kept", "fresh"]);
  assert.deepEqual(out.managed, ["fresh"]);
  assert.equal(reconcileMcp(current, undefined, ["old"]).changed, true, "a policy that dropped the section removes what it installed");
});

test("reconcileMcp: an unchanged file reports no change, even when a user server was added after the managed ones", () => {
  const current = { corp: server, mine: { command: "x" } };
  assert.equal(reconcileMcp(current, { servers: { corp: server } }, ["corp"]).changed, false);
  assert.equal(reconcileMcp({ a: 1 }, undefined, []).changed, false);
});

test("describeMcp: null without a section, else the startup line", () => {
  assert.equal(describeMcp(undefined), null);
  assert.equal(describeMcp({ servers: { a: server }, blockedServers: ["x", "y"], allowUserServers: false }), "[pista-host] managed mcp: 1 servers, 2 blocked, user servers disabled");
  assert.equal(describeMcp({}), "[pista-host] managed mcp: 0 servers, 0 blocked, user servers allowed");
});

test("ConfigStore: installs managed servers, persists managedMcp, and does not rewrite an unchanged file", () => {
  reset();
  writeFileSync(file, JSON.stringify({ keep: 1, mcpServers: { mine: { url: "https://m/mcp" } } }));
  const store = new ConfigStore(policy({ servers: { corp: server }, allowUserServers: false }));
  assert.deepEqual(Object.keys(read()), ["mine", "corp"]);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).keep, 1, "other top-level keys survive");
  assert.deepEqual(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).managedMcp, ["corp"]);
  assert.deepEqual(store.policy.mcp, { managedServers: ["corp"], allowUserServers: false });
  const before = statSync(file).mtimeMs;
  writeFileSync(file, readFileSync(file, "utf8")); // same bytes
  const stamp = statSync(file).mtimeMs;
  new ConfigStore(policy({ servers: { corp: server }, allowUserServers: false }));
  assert.equal(statSync(file).mtimeMs, stamp, "no write when nothing changed");
  assert.ok(stamp >= before);
});

test("ConfigStore: a server dropped from the policy disappears on the next start, blocked names go too", () => {
  reset();
  new ConfigStore(policy({ servers: { corp: server, gone: server } }));
  writeFileSync(file, JSON.stringify({ mcpServers: { ...read(), banned: { command: "z" }, mine: { command: "m" } } }));
  const store = new ConfigStore(policy({ servers: { corp: server }, blockedServers: ["banned"] }));
  assert.deepEqual(Object.keys(read()), ["corp", "mine"]);
  assert.deepEqual(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).managedMcp, ["corp"]);
  assert.deepEqual(store.config.mcpServers.map((s) => s.name), ["corp", "mine"]);
  // Policy removed altogether: what it installed goes, user servers stay.
  new ConfigStore();
  assert.deepEqual(Object.keys(read()), ["mine"]);
});

test("ConfigStore: no mcp section and nothing managed before leaves mcp.json alone", () => {
  reset();
  new ConfigStore();
  assert.equal(existsSync(file), false);
  const store = new ConfigStore({ policy: { version: 1 }, source: "t", sourceKind: null, warnings: [] });
  assert.equal(existsSync(file), false);
  assert.equal(store.policy.mcp, undefined);
});

test("ConfigStore: config.set cannot touch managed servers or add servers when users may not", () => {
  reset();
  const store = new ConfigStore(policy({ servers: { corp: server }, allowUserServers: false }));
  const [corp] = store.config.mcpServers;
  assert.throws(() => store.patchConfig({ mcpServers: [] }), /Not allowed by your organisation's policy: removing the managed MCP server "corp"/);
  assert.throws(() => store.patchConfig({ mcpServers: [{ ...corp!, exposure: "direct" }] }), /changing the managed MCP server/);
  assert.throws(() => store.patchConfig({ mcpServers: [corp!, { name: "mine", transport: "http", url: "https://m/mcp" }] }), /adding the MCP server "mine"/);
  store.patchConfig({ mcpServers: [corp!] });
  assert.deepEqual(Object.keys(read()), ["corp"]);
});

test("reconcileMcp: key order inside an entry does not count as a change", () => {
  const current = { corp: { env: { TOKEN: "${TOKEN}" }, args: ["-y", "srv"], command: "npx" } };
  assert.equal(reconcileMcp(current, { servers: { corp: server } }, ["corp"]).changed, false);
  assert.equal(Object.getPrototypeOf(reconcileMcp({}, { servers: { corp: server } }, []).servers), null);
});

test("ConfigStore: legacy config.json servers obey allowUserServers:false and blocked names", () => {
  reset();
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ config: { mcpServers: [{ name: "old", url: "https://o/mcp" }, { name: "banned", url: "https://b/mcp" }] } }),
  );
  const store = new ConfigStore(policy({ servers: { corp: server }, allowUserServers: false }));
  assert.deepEqual(Object.keys(read()), ["corp"]);
  assert.equal(store.policyWarnings.filter((w) => w.startsWith("mcp: legacy server")).length, 2);
  reset();
  writeFileSync(join(home, "config.json"), JSON.stringify({ config: { mcpServers: [{ name: "old", url: "https://o/mcp" }, { name: "banned", url: "https://b/mcp" }] } }));
  new ConfigStore(policy({ blockedServers: ["banned"] }));
  assert.deepEqual(Object.keys(read()), ["old"]);
});

test("ConfigStore: an untrusted policy leaves mcp.json and managedMcp alone and warns", () => {
  reset();
  new ConfigStore(policy({ servers: { corp: server }, blockedServers: ["banned"] }));
  writeFileSync(file, JSON.stringify({ mcpServers: { ...read(), banned: { command: "z" } } }));
  const store = new ConfigStore({ policy: null, source: null, sourceKind: null, warnings: [], mcpUntrusted: true });
  assert.deepEqual(Object.keys(read()), ["corp", "banned"], "nothing uninstalled, block not lifted");
  assert.deepEqual(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).managedMcp, ["corp"]);
  assert.ok(store.policyWarnings.some((w) => w.startsWith("mcp: the policy could not be read in full")));
  // A malformed mcp section in a loaded policy behaves the same.
  const bad = new ConfigStore({ policy: { version: 1, mcp: {} }, source: "t", sourceKind: null, warnings: [], mcpUntrusted: true });
  assert.deepEqual(Object.keys(read()), ["corp", "banned"]);
  assert.equal(bad.policyWarnings.length, 1);
  // An explicit policy without the section does uninstall.
  new ConfigStore({ policy: { version: 1 }, source: "t", sourceKind: null, warnings: [] });
  assert.deepEqual(Object.keys(read()), ["banned"]);
});

test("ConfigStore: Pi-only keys of a managed server survive reconcile followed by a UI save", () => {
  reset();
  const tooled = { url: "https://t/mcp", exposure: "hidden", toolExposure: { "get_*": "direct" }, type: "streamable-http" };
  const store = new ConfigStore(policy({ servers: { tooled }, allowUserServers: true }));
  store.patchConfig({ mcpServers: [...store.config.mcpServers, { name: "mine", transport: "http", url: "https://m/mcp" }] });
  assert.deepEqual(read().tooled, tooled);
  assert.equal(read().mine.url, "https://m/mcp");
});

test("ConfigStore: an mcp.json that is not valid JSON gives a warning and is not overwritten", () => {
  reset();
  writeFileSync(file, "{nope");
  const store = new ConfigStore(policy({ servers: { corp: server } }));
  assert.equal(readFileSync(file, "utf8"), "{nope");
  assert.ok(store.policyWarnings.some((w) => w.startsWith("mcp: could not apply to mcp.json")));
  assert.equal(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).managedMcp.length, 0);
});
