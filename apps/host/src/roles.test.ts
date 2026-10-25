import assert from "node:assert/strict";
import { test } from "node:test";
import type { HostConfig, ModelRef } from "@pista/protocol";
import { isRestrictedRole, isToolAllowed, resolveRoleModel, ROLES, roleGateExtension } from "./roles.ts";

const parent: ModelRef = { provider: "p", id: "big" };
const override: ModelRef = { provider: "p", id: "small" };
const config = (agentRoles?: HostConfig["agentRoles"]) => ({ agentRoles }) as HostConfig;

test("model resolution: config override, then parent", () => {
  assert.deepEqual(resolveRoleModel("explorer", config({ explorer: { model: override } }), parent), override);
  assert.deepEqual(resolveRoleModel("explorer", config(), parent), parent);
  assert.deepEqual(resolveRoleModel("explorer", config({ reviewer: { model: override } }), parent), parent);
  assert.equal(resolveRoleModel("implementer", config(), undefined), undefined);
});

test("model resolution: role default sits between override and parent", () => {
  const roleDefault: ModelRef = { provider: "p", id: "role-default" };
  ROLES.reviewer.model = roleDefault;
  try {
    assert.deepEqual(resolveRoleModel("reviewer", config(), parent), roleDefault);
    assert.deepEqual(resolveRoleModel("reviewer", config({ reviewer: { model: override } }), parent), override);
  } finally {
    delete ROLES.reviewer.model;
  }
});

test("allowlists", () => {
  for (const role of ["explorer", "reviewer"] as const) {
    assert.deepEqual(ROLES[role].tools, ["read", "grep", "find", "ls"]);
    assert.ok(isRestrictedRole(role));
    for (const tool of ["read", "grep", "find", "ls"]) assert.ok(isToolAllowed(role, tool), `${role} ${tool}`);
    for (const tool of ["write", "edit", "bash", "powershell", "codemode", "browser_click", "mcp__x__y"]) {
      assert.ok(!isToolAllowed(role, tool), `${role} ${tool}`);
    }
  }
  assert.ok(!isRestrictedRole("implementer"));
  for (const tool of ["write", "edit", "bash", "mcp__x__y"]) assert.ok(isToolAllowed("implementer", tool));
});

test("role gate blocks tools outside the allowlist", async () => {
  type Handler = (event: { toolName: string; input: unknown }) => { block?: boolean } | undefined;
  const handlers: Handler[] = [];
  const pi = { on: (type: string, h: Handler) => type === "tool_call" && handlers.push(h) };
  await (roleGateExtension("explorer") as { factory: (pi: unknown) => unknown }).factory(pi);
  assert.equal(handlers.length, 1);
  const call = (toolName: string) => handlers[0]!({ toolName, input: {} });
  for (const tool of ["write", "edit", "bash"]) assert.equal(call(tool)?.block, true, tool);
  assert.equal(call("read"), undefined);
});

test("model resolution: a role model the policy disallows falls back to the parent", () => {
  const policy = { version: 1 as const, models: { allow: ["p/big"] } };
  assert.deepEqual(resolveRoleModel("explorer", config({ explorer: { model: override } }), parent, policy), parent);
  assert.deepEqual(resolveRoleModel("explorer", config({ explorer: { model: parent } }), override, policy), parent);
});
