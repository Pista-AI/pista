import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import type { Plan, PlanStep, PlanStepStatus } from "@pista/protocol";
import { Type } from "typebox";
import type { RecordDecision } from "./decisions.ts";
import { clip } from "./text.ts";

export interface PlanStepInput {
  id?: string;
  title: string;
  status?: PlanStepStatus;
  dependsOn?: string[];
  note?: string;
}

export type PlanOp =
  | { op: "set"; steps: PlanStepInput[] }
  | { op: "update"; id: string; status?: PlanStepStatus; title?: string; note?: string; dependsOn?: string[] };

export interface PlanResult {
  plan: Plan;
  error?: string;
}

const EMPTY: Plan = { steps: [], updatedAt: 0 };

/** Dependencies must exist, not point a step at itself, and form no cycle. */
function validateGraph(steps: PlanStep[]): string | undefined {
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (dep === step.id) return `Step ${step.id} cannot depend on itself.`;
      if (!byId.has(dep)) return `Step ${step.id} depends on unknown step ${dep}.`;
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): string | undefined => {
    if (state.get(id) === "done") return undefined;
    if (state.get(id) === "visiting") return `Dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(" -> ")}.`;
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const error = visit(dep, [...path, id]);
      if (error) return error;
    }
    state.set(id, "done");
    return undefined;
  };
  for (const step of steps) {
    const error = visit(step.id, []);
    if (error) return error;
  }
  return undefined;
}

/** A step can only be in progress or done once everything it depends on is done. */
function validateStatuses(steps: PlanStep[]): string | undefined {
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const step of steps) {
    if (step.status !== "in_progress" && step.status !== "done") continue;
    const unmet = (step.dependsOn ?? []).filter((d) => byId.get(d)?.status !== "done");
    if (unmet.length) {
      return `${step.id} cannot be ${step.status} while ${unmet.join(", ")} ${unmet.length > 1 ? "are" : "is"} not done; mark ${step.id} pending first or finish ${unmet.join(", ")}.`;
    }
  }
  return undefined;
}

function normalise(step: PlanStep): PlanStep {
  const { dependsOn, note, ...rest } = step;
  return { ...rest, ...(dependsOn?.length ? { dependsOn } : {}), ...(note?.trim() ? { note: note.trim() } : {}) };
}

/** Pure plan reducer. On failure the previous plan comes back unchanged with `error`. */
export function applyPlanOp(plan: Plan | undefined, op: PlanOp): PlanResult {
  const previous = plan ?? EMPTY;
  const fail = (error: string): PlanResult => ({ plan: previous, error });

  let steps: PlanStep[];
  if (op.op === "set") {
    const explicit = new Set(op.steps.map((s) => s.id?.trim()).filter((id): id is string => Boolean(id)));
    const used = new Set<string>();
    steps = [];
    for (const [i, input] of op.steps.entries()) {
      if (!input.title?.trim()) return fail(`Step ${i + 1} needs a title.`);
      let id = input.id?.trim();
      if (!id) {
        let n = i + 1;
        while (explicit.has(`s${n}`) || used.has(`s${n}`)) n++;
        id = `s${n}`;
      }
      if (used.has(id)) return fail(`Duplicate step id ${id}.`);
      used.add(id);
      steps.push(normalise({ id, title: input.title.trim(), status: input.status ?? "pending", dependsOn: input.dependsOn, note: input.note }));
    }
  } else if (op.op === "update") {
    const index = previous.steps.findIndex((s) => s.id === op.id);
    if (index < 0) return fail(`Unknown step id ${op.id}.`);
    if (op.title !== undefined && !op.title.trim()) return fail("A step title cannot be empty.");
    const current = previous.steps[index]!;
    steps = [...previous.steps];
    steps[index] = normalise({
      ...current,
      ...(op.status ? { status: op.status } : {}),
      ...(op.title !== undefined ? { title: op.title.trim() } : {}),
      ...(op.note !== undefined ? { note: op.note } : {}),
      ...(op.dependsOn ? { dependsOn: op.dependsOn } : {}),
    });
  } else {
    return fail(`Unknown op ${(op as { op: string }).op}; use "set" or "update".`);
  }

  const error = validateGraph(steps) ?? validateStatuses(steps);
  if (error) return fail(error);
  return { plan: { steps, updatedAt: Date.now() } };
}

const STATUS_WORDS = new Set(["done", "completed", "complete", "finished", "progress", "created", "verified", "updated", "started"]);
const FILLER_WORDS = new Set(["in", "ok", "step", "marked", "marking", "now", "is", "as", "the", "it"]);

/** A reason that only restates a status ("Done.", "in_progress") says nothing about why. */
export function isStatusOnly(reason: string): boolean {
  const flat = reason.toLowerCase().replace(/_/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const words = flat.split(" ").filter(Boolean);
  if (words.every((w) => STATUS_WORDS.has(w) || FILLER_WORDS.has(w))) return true;
  return (words.length < 3 || flat.length < 12) && words.some((w) => STATUS_WORDS.has(w));
}

const MARKERS: Record<PlanStepStatus, string> = { pending: "[ ]", in_progress: "[~]", done: "[x]", blocked: "[!]" };

/** Deterministic Markdown for `.pista/PLAN.md` and tool results (no timestamps, so the prompt stays cache-stable). */
export function renderPlanMarkdown(plan: Plan): string {
  return plan.steps
    .map((s) => {
      const deps = s.dependsOn?.length ? ` (after: ${s.dependsOn.join(", ")})` : "";
      const note = s.note ? `\n${s.note.split("\n").map((l) => `    ${l}`).join("\n")}` : "";
      return `- ${MARKERS[s.status]} ${s.id} ${s.title}${deps}${note}`;
    })
    .join("\n");
}

export interface PlanToolOptions {
  getPlan: () => Plan | undefined;
  setPlan: (plan: Plan) => void;
  /** Logs a `plan_change` decision for each successful op. */
  record?: RecordDecision;
}

const Status = Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done"), Type.Literal("blocked")]);
const DependsOn = Type.Array(Type.String(), { description: "Ids of steps that must be done first" });

export function planTool(opts: PlanToolOptions): InlineExtension {
  return {
    name: "plan",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool(
        defineTool({
          name: "plan",
          label: "Plan",
          description:
            'Keep an ordered plan with step statuses for multi-step tasks. Use op "set" once to write the whole plan (a few concrete steps; ids default to s1, s2, ...), then op "update" to change one step\'s status (pending, in_progress, done, blocked), title, note or dependsOn as you work. A step can only be in_progress or done when the steps it depends on are done. Always give a reason: one sentence on why you are making this change (it is logged so the user can see why the plan changed). Update the status as each step completes. The user sees the plan next to the conversation. Skip it for simple one-step requests.',
          promptSnippet: "plan: write and update an ordered step plan with statuses for multi-step tasks",
          parameters: Type.Object({
            op: Type.Union([Type.Literal("set"), Type.Literal("update")], { description: "set replaces the whole plan; update changes one step" }),
            reason: Type.String({
              description:
                "Why this change, not what changed. Say what you learned or what it depends on, e.g. 'tests revealed the parser must change first, so s3 moves before s2'. A status restatement like 'done' is not a reason.",
            }),
            steps: Type.Optional(
              Type.Array(
                Type.Object({
                  id: Type.Optional(Type.String()),
                  title: Type.String(),
                  status: Type.Optional(Status),
                  dependsOn: Type.Optional(DependsOn),
                  note: Type.Optional(Type.String()),
                }),
                { description: "For op set: the full ordered list of steps" },
              ),
            ),
            id: Type.Optional(Type.String({ description: "For op update: the step to change" })),
            status: Type.Optional(Status),
            title: Type.Optional(Type.String()),
            note: Type.Optional(Type.String()),
            dependsOn: Type.Optional(DependsOn),
          }),
          execute: async (_id, params, _signal, _onUpdate, ctx) => {
            const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
            const current = opts.getPlan();
            const rendered = (plan: Plan | undefined) => (plan?.steps.length ? renderPlanMarkdown(plan) : "(no plan yet)");
            const reason = params.reason?.trim();
            if (!reason || isStatusOnly(reason)) return text(`Error: reason is required: say why this change is needed\n\nCurrent plan (unchanged):\n${rendered(current)}`);
            let op: PlanOp;
            if (params.op === "set") {
              if (!params.steps) return text(`Error: op set needs steps.\n\nCurrent plan:\n${rendered(current)}`);
              op = { op: "set", steps: params.steps };
            } else {
              if (!params.id) return text(`Error: op update needs id.\n\nCurrent plan:\n${rendered(current)}`);
              const { id, status, title, note, dependsOn } = params;
              op = { op: "update", id, status, title, note, dependsOn };
            }
            const result = applyPlanOp(current, op);
            if (result.error) return text(`Error: ${result.error}\n\nCurrent plan (unchanged):\n${rendered(current)}`);
            opts.setPlan(result.plan);
            if (opts.record) {
              const changed = op.op === "update" ? result.plan.steps.filter((s) => s.id === op.id) : result.plan.steps;
              opts.record({
                kind: "plan_change",
                summary:
                  op.op === "set"
                    ? `Plan set: ${changed.length} step${changed.length === 1 ? "" : "s"}`
                    : op.status
                      ? `${op.id} → ${op.status}`
                      : `${op.id} edited`,
                reason: clip(reason, 300),
                data: { op: op.op, stepIds: changed.map((s) => s.id), statuses: changed.map((s) => s.status) },
              });
            }
            // The plan is already stored and sent to the UI; the file mirror is best effort.
            let mirrorNote = "";
            try {
              const dir = join(ctx.cwd, ".pista");
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, "PLAN.md"), `${renderPlanMarkdown(result.plan)}\n`);
            } catch (error) {
              mirrorNote = `\nnote: could not write .pista/PLAN.md: ${(error as Error).message}`;
            }
            return text(`Plan updated:\n${rendered(result.plan)}${mirrorNote}`);
          },
        }),
      );
    },
  };
}
