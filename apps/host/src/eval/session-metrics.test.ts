import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("a parent `slices` call counts as a dispatch and the last board entry gives the slice outcomes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-metrics-"));
  try {
    const line = (o: unknown) => `${JSON.stringify(o)}\n`;
    const call = (name: string) => ({ type: "message", timestamp: "2026-10-30T10:00:01Z", message: { role: "assistant", content: [{ type: "toolCall", name, arguments: {} }], usage: { input: 10, output: 1 } } });
    const board = (phase: string, status: Record<string, string>) => ({ type: "custom", customType: "pista.slices", timestamp: "2026-10-30T10:00:02Z", data: { phase, status, slices: Object.keys(status).map((id) => ({ id })) } });
    const head = { type: "session", timestamp: "2026-10-30T10:00:00Z" };
    writeFileSync(join(dir, "parent.jsonl"), line(head) + line(call("slices")) + line(board("dispatch", { a: "running", b: "pending", c: "pending" })) + line(board("done", { a: "done", b: "failed", c: "skipped" })));
    writeFileSync(join(dir, "child.jsonl"), line({ ...head, parentSession: "parent.jsonl" }) + line(call("write")));
    assert.deepEqual(sessionMetrics(dir)!.sliced, { dispatched: true, slices: 3, done: 1, failed: 1, skipped: 1 });
    writeFileSync(join(dir, "parent.jsonl"), line(head) + line(call("slices")) + line(board("solo", { a: "pending", b: "pending" })));
    assert.deepEqual(sessionMetrics(dir)!.sliced, { dispatched: false, slices: 2, done: 0, failed: 0, skipped: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty directory has no metrics", () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-metrics-"));
  try {
    assert.equal(sessionMetrics(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
