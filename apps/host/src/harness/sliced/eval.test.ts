import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntryLike } from "../types.ts";
import { slicedEval } from "./eval.ts";

const board = (phase: string, status: Record<string, string>): SessionEntryLike => ({ type: "custom", customType: "pista.slices", data: { phase, status, slices: Object.keys(status) } });
const call: SessionEntryLike = { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "slices" }] } };

test("metrics count the last board, only after a slices call", () => {
  const entries = [board("plan", { a: "pending" }), board("run", { a: "done", b: "failed", c: "skipped" })];
  assert.equal(slicedEval.metrics(entries), undefined);
  assert.deepEqual(slicedEval.metrics([call, ...entries]), { dispatched: true, slices: 3, done: 1, failed: 1, skipped: 1 });
  assert.deepEqual(slicedEval.metrics([call, board("solo", { a: "pending" })]), { dispatched: false, slices: 1, done: 0, failed: 0, skipped: 0 });
});

test("column cell sums over runs and shows a dash for none", () => {
  const cell = slicedEval.column!.cell;
  const run = (dispatched: boolean, done: number, failed: number, skipped: number) => ({ dispatched, slices: done + failed + skipped, done, failed, skipped });
  assert.equal(cell([]), "–");
  assert.equal(cell([undefined]), "–");
  assert.equal(cell([run(true, 4, 1, 0)]), "1/1 dispatched; 4/1/0 of 5");
  assert.equal(cell([run(true, 4, 1, 0), undefined, run(false, 0, 0, 0)]), "1/2 dispatched; 4/1/0 of 5");
});
