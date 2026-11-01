import test from "node:test";
import assert from "node:assert/strict";
// The controller reads window.pistaDesktop at import time; stub it before loading.
(globalThis as { window?: unknown }).window = {};
const { browser } = await import("../src/browser/controller.ts");

const relay = (b: unknown, req: unknown) =>
  (browser as unknown as { handleNative(b: unknown, id: string, r: unknown): Promise<unknown> }).handleNative(b, "t", req);

test("login.list relays metadata", async () => {
  const meta = [{ id: "1", label: "Acme" }];
  assert.deepEqual(await relay({ logins: { list: async () => meta } }, { action: "login.list" }), { logins: meta });
});

test("login.fill passes only the site and returns ok/note", async () => {
  const seen: unknown[][] = [];
  const b = { logins: { fill: async (...a: unknown[]) => (seen.push(a), { ok: true, note: "filled" }) } };
  assert.deepEqual(await relay(b, { action: "login.fill", site: "acme.com" }), { login: { ok: true, note: "filled" } });
  assert.deepEqual(seen, [["acme.com"]]);
});

test("login ops throw without a logins bridge", async () => {
  await assert.rejects(relay({}, { action: "login.list" }), /cannot use saved logins/);
  await assert.rejects(relay({}, { action: "login.fill", site: "x" }), /cannot use saved logins/);
});
