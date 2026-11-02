import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readEncryptedFile } from "./auth-store.ts";
import { createEncryptedAuthStorageBackend } from "./mcp-auth-store.ts";
import { loadMcpOAuthCredentialStore } from "./pi-mcp-oauth.ts";

// Fails when a Pi upgrade moves or reshapes the class Pista deep-imports to encrypt MCP tokens.
test("installed Pi still exposes McpOAuthCredentialStore", async () => {
  const Ctor = await loadMcpOAuthCredentialStore();
  assert.equal(Ctor.name, "McpOAuthCredentialStore");
  assert.equal(Ctor.length, 2);
  for (const m of ["forServer", "tokens", "remove"]) assert.equal(typeof (Ctor.prototype as unknown as Record<string, unknown>)[m], "function");
});

test("the real Pi store writes tokens only through the encrypted backend", async () => {
  const Ctor = await loadMcpOAuthCredentialStore();
  const d = mkdtempSync(join(tmpdir(), "pista-pi-mcp-"));
  const key = Buffer.alloc(32, 5);
  const store = new Ctor(createEncryptedAuthStorageBackend({ file: join(d, "mcp-auth.enc.json"), key }), d);
  const server = store.forServer("srv", "https://example.test") as { save(state: unknown): Promise<void> | void };
  await server.save({ tokens: { access_token: "tok-drift-test", token_type: "Bearer" } });
  const plain = readEncryptedFile(join(d, "mcp-auth.enc.json"), key);
  assert.ok(plain?.includes("tok-drift-test"));
  assert.ok(!existsSync(join(d, "mcp-auth.json")));
  writeFileSync(join(d, "unused"), ""); // keeps the temp dir non-empty for debugging
});
