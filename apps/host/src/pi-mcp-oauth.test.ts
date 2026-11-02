import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMcpOAuthCredentialStore } from "./pi-mcp-oauth.ts";

// Fails when a Pi upgrade moves or reshapes the class Pista deep-imports to encrypt MCP tokens.
test("installed Pi still exposes McpOAuthCredentialStore", async () => {
  const Ctor = await loadMcpOAuthCredentialStore();
  assert.equal(Ctor.name, "McpOAuthCredentialStore");
  for (const m of ["forServer", "tokens", "remove"]) assert.equal(typeof (Ctor.prototype as unknown as Record<string, unknown>)[m], "function");
});
