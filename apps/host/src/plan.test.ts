import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Plan } from "@pista/protocol";
import { applyPlanOp, planTool, renderPlanMarkdown, type PlanOp } from "./plan.ts";

type SetSteps = Extract<PlanOp, { op: "set" }>["steps"];
const set = (steps: SetSteps, plan?: Plan) => applyPlanOp(plan, { op: "set", steps });

test("set assigns s1..sn ids and defaults to pending", () => {
  const { plan, error } = set([{ title: "Read" }, { title: "Write", dependsOn: ["s1"] }, { title: "Test", note: " run it " }]);
  assert.equal(error, undefined);
  assert.deepEqual(plan.steps.map((s) => [s.id, s.status]), [["s1", "pending"], ["s2", "pending"], ["s3", "pending"]]);
  assert.deepEqual(plan.steps[1]!.dependsOn, ["s1"]);
  assert.equal(plan.steps[2]!.note, "run it");
  assert.ok(plan.updatedAt > 0);
});

test("auto ids skip explicit ids and duplicates are rejected", () => {
  const { plan } = set([{ id: "s1", title: "A" }, { title: "B" }]);
  assert.deepEqual(plan.steps.map((s) => s.id), ["s1", "s2"]);
  assert.match(set([{ id: "x", title: "A" }, { id: "x", title: "B" }]).error ?? "", /Duplicate/);
});

test("update changes one step and keeps the rest", () => {
  const base = set([{ title: "A" }, { title: "B" }]).plan;
  const { plan, error } = applyPlanOp(base, { op: "update", id: "s1", status: "done", note: "ok" });
  assert.equal(error, undefined);
  assert.equal(plan.steps[0]!.status, "done");
  assert.equal(plan.steps[0]!.note, "ok");
  assert.deepEqual(plan.steps[1], base.steps[1]);
});

test("unknown ids are rejected and the previous plan is returned", () => {
  const base = set([{ title: "A" }]).plan;
  const result = applyPlanOp(base, { op: "update", id: "nope", status: "done" });
  assert.match(result.error ?? "", /Unknown step/);
  assert.equal(result.plan, base);
  assert.match(set([{ title: "A", dependsOn: ["zzz"] }]).error ?? "", /unknown step zzz/);
});

test("dependency cycles are rejected", () => {
  assert.match(set([{ id: "a", title: "A", dependsOn: ["b"] }, { id: "b", title: "B", dependsOn: ["a"] }]).error ?? "", /cycle/);
  const base = set([{ title: "A" }, { title: "B", dependsOn: ["s1"] }]).plan;
  const result = applyPlanOp(base, { op: "update", id: "s1", dependsOn: ["s2"] });
  assert.match(result.error ?? "", /cycle/);
  assert.equal(result.plan, base);
  assert.match(applyPlanOp(base, { op: "update", id: "s1", dependsOn: ["s1"] }).error ?? "", /itself/);
});

test("a long dependency cycle is rejected", () => {
  const error = set([{ title: "A", dependsOn: ["s3"] }, { title: "B", dependsOn: ["s1"] }, { title: "C", dependsOn: ["s2"] }]).error ?? "";
  assert.match(error, /cycle/);
  assert.match(error, /s1 -> s3 -> s2 -> s1/);
});

test("a failing PLAN.md write is reported but the plan is still set", async () => {
  const blocked = mkdtempSync(join(tmpdir(), "pista-plan-blocked-"));
  after(() => rmSync(blocked, { recursive: true, force: true }));
  writeFileSync(join(blocked, ".pista"), "not a directory");
  let plan: Plan | undefined;
  const tool = registeredTool({ getPlan: () => plan, setPlan: (p) => (plan = p) });
  const out = (await tool.execute("t", { op: "set", reason: "r", steps: [{ title: "A" }] }, undefined, undefined, { cwd: blocked })).content[0]!.text;
  assert.match(out, /^Plan updated:\n- \[ \] s1 A\nnote: could not write \.pista\/PLAN\.md: /);
  assert.equal(plan?.steps.length, 1);
});

test("in_progress and done need finished dependencies; a done chain is allowed", () => {
  const base = set([{ title: "A" }, { title: "B", dependsOn: ["s1"] }]).plan;
  assert.match(applyPlanOp(base, { op: "update", id: "s2", status: "in_progress" }).error ?? "", /s1 is not done/);
  assert.match(applyPlanOp(base, { op: "update", id: "s2", status: "done" }).error ?? "", /not done/);
  assert.match(set([{ title: "A", status: "pending" }, { title: "B", status: "in_progress", dependsOn: ["s1"] }]).error ?? "", /s2 cannot be in_progress/);
  let plan = base;
  for (const [id, status] of [["s1", "done"], ["s2", "in_progress"], ["s2", "done"]] as const) {
    const next = applyPlanOp(plan, { op: "update", id, status });
    assert.equal(next.error, undefined);
    plan = next.plan;
  }
  assert.deepEqual(plan.steps.map((s) => s.status), ["done", "done"]);
  assert.equal(applyPlanOp(base, { op: "update", id: "s2", status: "blocked" }).error, undefined);
});

test("render is deterministic, compact and has no timestamp", () => {
  const a = set([{ title: "Read" }, { title: "Write", status: "blocked", dependsOn: ["s1"], note: "needs\naccess" }]).plan;
  const b: Plan = { ...a, updatedAt: a.updatedAt + 5000 };
  const text = renderPlanMarkdown(a);
  assert.equal(text, renderPlanMarkdown(a));
  assert.equal(text, renderPlanMarkdown(b));
  assert.equal(text, "- [ ] s1 Read\n- [!] s2 Write (after: s1)\n    needs\n    access");
  assert.ok(!text.includes(String(a.updatedAt)));
});

type Tool = { execute(id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: { cwd: string }): Promise<{ content: { text: string }[] }> };

function registeredTool(opts: Parameters<typeof planTool>[0]): Tool {
  let tool: Tool | undefined;
  const extension = planTool(opts);
  (extension as unknown as { factory(pi: unknown): void }).factory({ registerTool: (t: Tool) => (tool = t) });
  return tool!;
}

const cwd = mkdtempSync(join(tmpdir(), "pista-plan-"));
after(() => rmSync(cwd, { recursive: true, force: true }));

test("a successful plan op records plan_change with the model's reason; a reducer error records nothing", async () => {
  let plan: Plan | undefined;
  const decisions: { kind: string; summary: string; reason?: string; data?: unknown }[] = [];
  const tool = registeredTool({ getPlan: () => plan, setPlan: (p) => (plan = p), record: (d) => void decisions.push(d) });
  const run = (params: unknown) => tool.execute("t", params, undefined, undefined, { cwd });
  await run({ op: "set", reason: "Break the task down", steps: [{ title: "A" }, { title: "B", dependsOn: ["s1"] }] });
  await run({ op: "update", reason: "Unmet dependency", id: "s2", status: "done" });
  await run({ op: "update", reason: "Reading showed the parser is next", id: "s1", status: "in_progress" });
  assert.deepEqual(decisions, [
    { kind: "plan_change", summary: "Plan set: 2 steps", reason: "Break the task down", data: { op: "set", stepIds: ["s1", "s2"], statuses: ["pending", "pending"] } },
    { kind: "plan_change", summary: "s1 → in_progress", reason: "Reading showed the parser is next", data: { op: "update", stepIds: ["s1"], statuses: ["in_progress"] } },
  ]);
});

test("a missing or blank reason is rejected like a reducer error: nothing changes and nothing is logged", async () => {
  let plan: Plan | undefined;
  const decisions: unknown[] = [];
  const tool = registeredTool({ getPlan: () => plan, setPlan: (p) => (plan = p), record: (d) => void decisions.push(d) });
  for (const reason of [undefined, "", "   ", "done", " Done. ", "In progress", "in_progress", "Completed!", "created", "done, verified", "Marking step done", "ok"]) {
    const out = (await tool.execute("t", { op: "set", reason, steps: [{ title: "A" }] }, undefined, undefined, { cwd })).content[0]!.text;
    assert.match(out, /^Error: reason is required: say why this change is needed/);
  }
  assert.equal(plan, undefined);
  assert.deepEqual(decisions, []);
});

test("a long reason is clipped to 300 characters", async () => {
  let plan: Plan | undefined;
  const decisions: { reason?: string }[] = [];
  const tool = registeredTool({ getPlan: () => plan, setPlan: (p) => (plan = p), record: (d) => void decisions.push(d) });
  await tool.execute("t", { op: "set", reason: "x".repeat(1000), steps: [{ title: "A" }] }, undefined, undefined, { cwd });
  assert.equal(decisions[0]!.reason!.length, 300);
});

test("the plan tool updates the plan, writes PLAN.md and reports errors as text", async () => {
  let plan: Plan | undefined;
  const calls: Plan[] = [];
  const tool = registeredTool({ getPlan: () => plan, setPlan: (p) => ((plan = p), calls.push(p)) });
  const run = async (params: unknown) => (await tool.execute("t", params, undefined, undefined, { cwd })).content[0]!.text;

  const first = await run({ op: "set", reason: "r", steps: [{ title: "A" }, { title: "B", dependsOn: ["s1"] }] });
  assert.match(first, /Plan updated:\n- \[ \] s1 A\n- \[ \] s2 B \(after: s1\)/);
  assert.equal(calls.length, 1);
  assert.equal(readFileSync(join(cwd, ".pista", "PLAN.md"), "utf8"), "- [ ] s1 A\n- [ ] s2 B (after: s1)\n");

  const bad = await run({ op: "update", reason: "r", id: "s2", status: "done" });
  assert.match(bad, /^Error: s2 cannot be done while s1 is not done; mark s2 pending first or finish s1\./);
  assert.match(bad, /- \[ \] s2 B/);
  assert.equal(calls.length, 1);

  assert.match(await run({ op: "update", reason: "r" }), /needs id/);
  await run({ op: "update", reason: "r", id: "s1", status: "done" });
  assert.equal(plan!.steps[0]!.status, "done");
  assert.equal(readFileSync(join(cwd, ".pista", "PLAN.md"), "utf8"), "- [x] s1 A\n- [ ] s2 B (after: s1)\n");
});

test("a reason that gives the why is accepted, even one that merely contains a status word", async () => {
  let plan: Plan | undefined;
  const tool = registeredTool({ getPlan: () => plan, setPlan: (p) => (plan = p) });
  for (const reason of ["tests revealed the parser must change first, so s3 moves before s2", "tests revealed the parser must change first", "done with the parser, so the writer can start"]) {
    const out = (await tool.execute("t", { op: "set", reason, steps: [{ title: "A" }] }, undefined, undefined, { cwd })).content[0]!.text;
    assert.match(out, /^Plan updated/);
  }
});
