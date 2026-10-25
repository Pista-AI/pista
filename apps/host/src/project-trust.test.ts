import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "@pista/protocol";
import { fauxModels, setupHome } from "./test-helpers.ts";

// Not `after()`: the session tests below are registered after top-level awaits, so a root hook would fire early.
const { root, agentDir } = setupHome("project-trust", { cleanup: "exit" });
const { resolveProjectTrust } = await import("./project-trust.ts");

const project = (path: string, trusted?: boolean): Project => ({ id: path, name: path, path, ...(trusted === undefined ? {} : { trusted }) });

test("the default workspace is trusted without a flag", () => {
  const workspace = join(root, "home", "workspace");
  mkdirSync(workspace, { recursive: true });
  assert.deepEqual(resolveProjectTrust(workspace, [project(workspace)], workspace), { trusted: true, reason: "default workspace" });
});

test("a project without the flag, or with trusted: false, is untrusted", () => {
  const dir = mkdtempSync(join(root, "p-"));
  assert.equal(resolveProjectTrust(dir, [project(dir)], join(root, "ws")).trusted, false);
  assert.equal(resolveProjectTrust(dir, [project(dir, false)], join(root, "ws")).trusted, false);
});

test("a project with trusted: true is trusted", () => {
  const dir = mkdtempSync(join(root, "p-"));
  assert.equal(resolveProjectTrust(dir, [project(dir, true)], join(root, "ws")).trusted, true);
});

test("a folder that is not a project is untrusted, even next to a trusted one", () => {
  const known = mkdtempSync(join(root, "p-"));
  const other = mkdtempSync(join(root, "p-"));
  assert.equal(resolveProjectTrust(other, [project(known, true)], join(root, "ws")).trusted, false);
});

// -- a hostile .pi/ folder, through a real Pi session -------------------------------------------

const { createMcpExtension, ModelRuntime, SessionManager } = await import("@earendil-works/pi-coding-agent");
const { buildSession } = await import("./session.ts");

const evilFlag = globalThis as { __evilExtensionLoaded?: boolean };

/** A repo that ships its own MCP server, a project setting and an extension. */
function hostileProject(): string {
  const cwd = mkdtempSync(join(root, "hostile-"));
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { evil: { command: "echo", args: ["pwned"] } } }));
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ defaultThinkingLevel: "high" }));
  writeFileSync(join(cwd, ".pi", "extensions", "evil.js"), "export default () => { globalThis.__evilExtensionLoaded = true; };\n");
  writeFileSync(join(cwd, "AGENTS.md"), "PROJECT-RULE-ABC");
  return cwd;
}

async function open(cwd: string, projectTrusted?: boolean) {
  const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const { models, ref } = await fauxModels(runtime);
  const session = await buildSession({
    cwd,
    models,
    model: ref,
    ...(projectTrusted === undefined ? {} : { projectTrusted }),
    sessionManager: SessionManager.inMemory(cwd),
    appendSystemPrompt: [],
    extensionFactories: [createMcpExtension()],
  });
  const notes: string[] = [];
  await session.bindExtensions({ uiContext: { notify: (message: string) => void notes.push(message) } as never });
  // Pi's built-in MCP extension answers `/mcp` with the servers it read from the mcp.json files, without a model call.
  await session.prompt("/mcp");
  return { session, mcpStatus: notes.join("\n") };
}

test("an untrusted project's .pi/ is ignored (the default); AGENTS.md still loads", async () => {
  delete evilFlag.__evilExtensionLoaded;
  const { session, mcpStatus } = await open(hostileProject());
  assert.equal(session.settingsManager.isProjectTrusted(), false);
  assert.ok(!mcpStatus.includes("evil"), `project mcp.json not read: ${mcpStatus}`);
  assert.equal(evilFlag.__evilExtensionLoaded, undefined, "project extension not loaded");
  assert.notEqual(session.settingsManager.getDefaultThinkingLevel(), "high", "project settings not read");
  assert.ok(session.systemPrompt.includes("PROJECT-RULE-ABC"), "AGENTS.md loads regardless of trust");
});

test("a trusted project's .pi/ loads", async () => {
  delete evilFlag.__evilExtensionLoaded;
  const { session, mcpStatus } = await open(hostileProject(), true);
  assert.equal(session.settingsManager.isProjectTrusted(), true);
  assert.ok(mcpStatus.includes("evil:"), `project mcp.json read: ${mcpStatus}`);
  assert.equal(evilFlag.__evilExtensionLoaded, true, "project extension loaded");
  assert.equal(session.settingsManager.getDefaultThinkingLevel(), "high");
});

test("user-level mcp.json in the agent dir loads whether or not the project is trusted", async () => {
  writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { mine: { command: "echo" } } }));
  for (const trusted of [false, true]) {
    const { mcpStatus } = await open(hostileProject(), trusted);
    assert.ok(mcpStatus.includes("mine:"), `trusted=${trusted}: ${mcpStatus}`);
  }
});

test("buildSession keeps the local-model compaction overrides through the resource reload", async () => {
  const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const { models, ref } = await fauxModels(runtime, { contextWindow: 18000 });
  const model = models.getModel(ref.provider, ref.id)!;
  const session = await buildSession({
    cwd: hostileProject(),
    models,
    model: ref,
    isLocal: (m) => m.provider === ref.provider,
    sessionManager: SessionManager.inMemory(root),
    appendSystemPrompt: [],
    extensionFactories: [],
  });
  assert.ok(model.contextWindow > 0);
  assert.ok(session.settingsManager.getCompactionReserveTokens(model) < 16384, "override survives reload()");
});

test("ThreadManager.load passes the resolved trust into the session", async () => {
  const { makeManager, liveOf } = await import("./test-helpers.ts");
  type Live = { session: { settingsManager: { isProjectTrusted(): boolean } } };
  const { manager, store, project } = await makeManager({ projectDir: mkdtempSync(join(root, "proj-")) });
  const trustedOf = async () => liveOf<Live>(manager).get((await manager.create(project.id)).summary.id)!.session.settingsManager.isProjectTrusted();
  assert.equal(await trustedOf(), false);
  store.setProjectTrusted(project.id, true);
  assert.equal(await trustedOf(), true);
});
