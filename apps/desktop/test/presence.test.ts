import assert from "node:assert/strict";
import { test } from "node:test";
import { createPresenceGate } from "../src/presence.ts";

function setup(opts: { canPrompt?: boolean; fail?: boolean } = {}) {
  let t = 0;
  let prompts = 0;
  const gate = createPresenceGate({
    canPrompt: () => opts.canPrompt ?? true,
    prompt: async () => {
      prompts++;
      if (opts.fail) throw new Error("cancelled");
    },
    now: () => t,
    ttlMs: 1000,
  });
  return { gate, prompts: () => prompts, advance: (ms: number) => (t += ms) };
}

test("first call prompts, later calls reuse the unlock", async () => {
  const s = setup();
  assert.deepEqual(await s.gate.ensure(), { ok: true });
  assert.deepEqual(await s.gate.ensure(), { ok: true });
  assert.equal(s.prompts(), 1);
});

test("the unlock expires after the ttl", async () => {
  const s = setup();
  await s.gate.ensure();
  s.advance(999);
  await s.gate.ensure();
  assert.equal(s.prompts(), 1);
  s.advance(1);
  await s.gate.ensure();
  assert.equal(s.prompts(), 2);
});

test("lock() (machine resumed from sleep) asks again", async () => {
  const s = setup();
  await s.gate.ensure();
  s.gate.lock();
  await s.gate.ensure();
  assert.equal(s.prompts(), 2);
});

test("a failed prompt refuses and does not unlock", async () => {
  const s = setup({ fail: true });
  assert.deepEqual(await s.gate.ensure(), { ok: false, error: "Sign-in was not confirmed." });
  await s.gate.ensure();
  assert.equal(s.prompts(), 2);
});

test("without a way to prompt the check is skipped", async () => {
  const s = setup({ canPrompt: false });
  assert.deepEqual(await s.gate.ensure(), { ok: true });
  assert.equal(s.prompts(), 0);
});

test("concurrent calls share one prompt", async () => {
  const s = setup();
  await Promise.all([s.gate.ensure(), s.gate.ensure()]);
  assert.equal(s.prompts(), 1);
});
