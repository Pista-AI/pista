import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { ManagedPolicy } from "@pista/protocol";
import { AgentRoles, parseAgentFile } from "./agent-roles.ts";
import { availableRoles, isToolAllowed, resolveRoleModel, roleOf, rolePrompt, roleGateExtension } from "./roles.ts";
import { agentToolExtension } from "./subagent.ts";
import { makeManager, setupHome } from "./test-helpers.ts";

const { home, projectDir } = setupHome("agent-roles");
const { extensionsFor } = await import("./children.ts");

const scout = `---
name: scout
description: Finds things.
tools: read, grep
model: p/small
thinking: low
foo: ignored
---
Be quick.
`;
const write = (dir: string, file: string, text: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), text);
};
const make = (opts: { trusted?: boolean; overrides?: Record<string, object> } = {}) => {
  const warnings: string[] = [];
  const roles = new AgentRoles({ userDir: join(home, "agents"), isTrusted: () => opts.trusted ?? false, overrides: () => opts.overrides, warn: (m) => warnings.push(m) });
  return { roles, warnings };
};
const names = (list: InlineExtension[]) => list.map((e) => (typeof e === "function" ? "pi" : e.name));
type Handler = (event: { toolName: string; input: unknown; toolCallId: string }) => { block?: boolean } | undefined;
const handlersOf = async (ext: InlineExtension) => {
  const handlers: Handler[] = [];
  await (ext as { factory: (pi: unknown) => unknown }).factory({ on: (type: string, h: Handler) => type === "tool_call" && handlers.push(h), getActiveTools: () => [], setActiveTools: () => {} });
  return handlers;
};

test("a user-level role file is loaded, listed to the model and parsed (unknown keys ignored)", async () => {
  write(join(home, "agents"), "scout.md", scout);
  const { roles } = make();
  const map = roles.forProject(projectDir);
  assert.deepEqual(map.scout, {
    name: "scout", description: "Finds things.", tools: ["read", "grep"], model: { provider: "p", id: "small" }, thinking: "low", prompt: "Be quick.", promptMode: "append",
  });
  assert.ok(availableRoles(map).some((r) => r.name === "explorer"), "built-ins stay");
  let description = "";
  await (agentToolExtension({ threads: {} as never, ref: { threadId: "t" }, roles: map }) as { factory: (pi: unknown) => unknown }).factory({ registerTool: (t: { description: string }) => (description = t.description) });
  assert.match(description, /scout \(Finds things\.\)/);
  assert.match(rolePrompt("scout", map), /Sub-agent role: scout[\s\S]*Be quick\./);
  assert.equal(rolePrompt("scout", { scout: { ...map.scout!, promptMode: "replace" } }), "Be quick.");
});

test("a custom role child gets the same gates as a built-in one, and a policy-denied tool stays blocked", async () => {
  const policy: ManagedPolicy = { version: 1, tools: { deny: ["bash"] } };
  const { store, hub, manager } = await makeManager({ policy });
  const roles = { worker: { name: "worker", description: "Works.", tools: [], excludeTools: ["write"] } };
  const deps = { store, hub, ref: { threadId: "t" }, threads: manager, plan: { getPlan: () => undefined, setPlan: () => {} }, roles };
  const list = extensionsFor({ role: "worker", restricted: false, isChild: true }, deps);
  assert.deepEqual(names(list), [...names(extensionsFor({ role: "implementer", restricted: false, isChild: true }, { ...deps, roles: undefined }))]);
  for (const gate of ["role-gate", "approvals", "policy-gate"]) assert.ok(names(list).includes(gate), gate);
  const call = async (toolName: string) => {
    for (const ext of list.filter((e) => typeof e !== "function" && ["role-gate", "policy-gate"].includes(e.name))) {
      const result = (await handlersOf(ext)).map((h) => h({ toolName, input: { command: "ls" }, toolCallId: "c" })).find(Boolean);
      if (result?.block) return result;
    }
    return undefined;
  };
  assert.equal((await call("bash"))?.block, true, "org policy still denies");
  assert.equal((await call("write"))?.block, true, "excludeTools");
  assert.equal(await call("read"), undefined);
});

test("tools in a file only narrow: allowlist, excludeTools and overrides intersect", () => {
  assert.deepEqual(parseAgentFile("---\nname: a\ndescription: d\ntools:\n  - read\n  - grep\nexcludeTools: grep\n---\n").excludeTools, ["grep"]);
  const map = { a: { name: "a", description: "d", tools: ["read", "grep"], excludeTools: ["grep"] } };
  assert.ok(isToolAllowed("a", "read", map));
  assert.ok(!isToolAllowed("a", "grep", map), "excluded");
  assert.ok(!isToolAllowed("a", "bash", map), "not in the allowlist");
  assert.equal((roleGateExtension("a", map) as { name: string }).name, "role-gate");
  write(join(home, "agents"), "scout.md", scout);
  const { roles } = make({ overrides: { scout: { tools: ["grep", "bash"] }, explorer: { tools: ["write"] } } });
  const effective = roles.forProject(projectDir);
  assert.deepEqual(effective.scout!.tools, ["grep"], "override cannot add bash");
  assert.equal(effective.explorer!.disabled, true, "an empty intersection switches the role off, not on");
});

test("malformed files are skipped with a warning", () => {
  const dir = join(home, "agents");
  write(dir, "bad-yaml.md", "---\nname: [oops\n---\nx");
  write(dir, "no-name.md", "---\ndescription: d\n---\nx");
  write(dir, "no-desc.md", "---\nname: x\n---\nx");
  write(dir, "bad-name.md", "---\nname: Bad Name\ndescription: d\n---\nx");
  write(dir, "bad-model.md", "---\nname: m\ndescription: d\nmodel: nomodel\n---\nx");
  write(dir, "good.md", "---\nname: good\ndescription: d\n---\nx");
  const { roles, warnings } = make();
  const map = roles.forProject(projectDir);
  assert.ok(map.good && map.scout);
  for (const name of ["x", "m"]) assert.equal(map[name], undefined);
  assert.equal(warnings.filter((w) => /skipped agent file/.test(w)).length, 5);
});

test("project-level files load only for a trusted project and win over user files", () => {
  write(join(projectDir, ".pista", "agents"), "scout.md", "---\nname: scout\ndescription: Project scout.\n---\n");
  write(join(projectDir, ".pista", "agents"), "local.md", "---\nname: local\ndescription: Local.\n---\n");
  assert.equal(make({ trusted: false }).roles.forProject(projectDir).local, undefined);
  assert.equal(make({ trusted: false }).roles.forProject(projectDir).scout!.description, "Finds things.");
  const trusted = make({ trusted: true }).roles.forProject(projectDir);
  assert.ok(trusted.local);
  assert.equal(trusted.scout!.description, "Project scout.");
});

test("agentOverrides apply to built-in and file roles and beat agentRoles for the model", () => {
  const { roles } = make({ overrides: { scout: { thinking: "high", excludeTools: ["grep"] }, reviewer: { disabled: true } } });
  const map = roles.forProject(projectDir);
  assert.equal(map.scout!.thinking, "high");
  assert.deepEqual(map.scout!.excludeTools, ["grep"]);
  assert.ok(!availableRoles(map).some((r) => r.name === "reviewer"));
  const config = { agentRoles: { scout: { model: { provider: "p", id: "a" } } }, agentOverrides: { scout: { model: { provider: "p", id: "b" } } } } as never;
  assert.deepEqual(resolveRoleModel("scout", config, undefined, null, map), { provider: "p", id: "b" });
  assert.deepEqual(resolveRoleModel("scout", { agentRoles: (config as { agentRoles: object }).agentRoles } as never, undefined, null, map), { provider: "p", id: "a" });
});

test("a file named like a built-in can only narrow it", () => {
  const dir = join(home, "agents");
  write(dir, "reviewer.md", "---\nname: reviewer\ndescription: Mine.\n---\nExtra.");
  write(dir, "explorer.md", "---\nname: explorer\ndescription: Mine.\ntools: read, bash\nexcludeTools: grep\n---\n");
  write(dir, "implementer.md", "---\nname: implementer\ndescription: Mine.\ntools: read\n---\n");
  const map = make().roles.forProject(projectDir);
  assert.deepEqual(map.reviewer!.tools, ["read", "grep", "find", "ls"], "omitted tools keeps the built-in set");
  assert.ok(!isToolAllowed("reviewer", "bash", map));
  assert.equal(map.reviewer!.prompt, "Extra.");
  assert.deepEqual(map.explorer!.tools, ["read"], "bash is outside the built-in ceiling");
  assert.deepEqual(map.explorer!.excludeTools, ["grep"]);
  assert.deepEqual(map.implementer!.tools, ["read"], "unrestricted built-in: the file narrows");
});

test("revoked trust drops project roles on the next call", () => {
  let trusted = true;
  const roles = new AgentRoles({ userDir: join(home, "agents"), isTrusted: () => trusted, overrides: () => undefined, warn: () => {} });
  assert.ok(roles.forProject(projectDir).local);
  trusted = false;
  assert.equal(roles.forProject(projectDir).local, undefined);
});

test("prototype names fail closed and a deleted role falls back to read-only", () => {
  const map = make({ overrides: { constructor: { disabled: true }, toString: { tools: ["write"] } } }).roles.forProject(projectDir);
  assert.deepEqual(roleOf("constructor", map).tools, ["read", "grep", "find", "ls"]);
  assert.ok(!isToolAllowed("constructor", "write", map));
  assert.ok(!isToolAllowed("deleted-role", "bash", map));
  assert.throws(() => assert.ok(availableRoles(map).some((r) => r.name === "constructor")));
});

test("duplicate names in one folder warn", () => {
  const dir = join(home, "agents");
  write(dir, "dup-a.md", "---\nname: dup\ndescription: a\n---\n");
  write(dir, "dup-b.md", "---\nname: dup\ndescription: b\n---\n");
  const { roles, warnings } = make();
  assert.equal(roles.forProject(projectDir).dup!.description, "b");
  assert.ok(warnings.some((w) => /name "dup"/.test(w)));
});
