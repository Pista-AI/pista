import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionMetrics } from "./session-metrics.ts";

const fixture = fileURLToPath(new URL("./fixtures/sessions/run", import.meta.url));

test("metrics come from the parent session and its child", () => {
  const m = sessionMetrics(fixture)!;
  assert.equal(m.parentPeakContext, 1700); // 200 + 1500 on the second request
  assert.equal(m.compactions, 1);
  assert.equal(m.childCompactions, 1);
  assert.equal(m.parentTokens, 1600 + 1750 + 920);
  assert.equal(m.childTokens, 600);
  assert.equal(m.parentShare, 4270 / 4870);
  assert.deepEqual(m.agentCallsByRole, { explorer: 1, implementer: 1 });
  assert.equal(m.briefsWithCode, 1);
  assert.equal(m.wallClockSeconds, 90);
});

test("an empty directory has no metrics", () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-metrics-"));
  try {
    assert.equal(sessionMetrics(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
