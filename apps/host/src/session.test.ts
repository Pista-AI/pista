import assert from "node:assert/strict";
import { test } from "node:test";
import { localCompactionSettings } from "./session.ts";

test("compaction thresholds scale with the window", () => {
  assert.deepEqual(localCompactionSettings(18000), { reserveTokens: 6144, keepRecentTokens: 5940 });
  assert.deepEqual(localCompactionSettings(22272), { reserveTokens: 6144, keepRecentTokens: 7350 });
  assert.deepEqual(localCompactionSettings(32768), { reserveTokens: 7209, keepRecentTokens: 10813 });
});

test("reserve covers Pi's 4096 safety margin plus a reply, so compaction runs before replies are squeezed", () => {
  for (const window of [16384, 32768]) {
    const { reserveTokens, keepRecentTokens } = localCompactionSettings(window);
    assert.ok(reserveTokens >= 4096 + 2048, `${window} reserve ${reserveTokens}`);
    assert.ok(reserveTokens < window && keepRecentTokens + reserveTokens < window, `${window}`);
  }
});

test("large windows are capped at Pi's defaults", () => {
  assert.deepEqual(localCompactionSettings(131072), { reserveTokens: 16384, keepRecentTokens: 20000 });
});

test("tiny windows keep reserve plus kept tail inside the window", () => {
  for (const window of [2048, 3000, 4096, 8192]) {
    const { reserveTokens, keepRecentTokens } = localCompactionSettings(window);
    assert.ok(keepRecentTokens >= 1 && keepRecentTokens + reserveTokens < window, `${window}`);
  }
});

test("compaction overrides survive a settings save once reapplied", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { buildSettings, reapplyCompactionOverrides } = await import("./session.ts");
  const dir = mkdtempSync(join(tmpdir(), "pista-settings-"));
  const model = { provider: "lm", id: "small", contextWindow: 18000 };
  const models = { getModels: () => [model, { provider: "cloud", id: "big", contextWindow: 200000 }] } as never;
  const isLocal = (m: { provider: string }) => m.provider === "lm";

  const settings = buildSettings(dir, dir, models, isLocal);
  assert.equal(settings.getCompactionReserveTokens(model), 6144);
  assert.equal(settings.getCompactionReserveTokens({ provider: "cloud", id: "big" }), 16384);

  settings.setCompactionEnabled(true); // saving rebuilds from files, like session.setModel
  assert.equal(settings.getCompactionReserveTokens(model), 16384, "save drops in-memory overrides");

  reapplyCompactionOverrides(settings, models, isLocal);
  assert.equal(settings.getCompactionReserveTokens(model), 6144);
  assert.equal(settings.getCompactionKeepRecentTokens(model), 5940);
});
