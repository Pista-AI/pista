import type { DecisionEntry, GoalState, PlanStepStatus } from "@pista/protocol";

export type Tone = "accent" | "success" | "warning" | "muted";

export const GOAL_TONE: Record<GoalState["status"], Tone> = {
  running: "accent",
  paused: "muted",
  met: "success",
  impossible: "warning",
  budget_exhausted: "warning",
  no_progress: "warning",
};

export const STEP_TONE: Record<PlanStepStatus, Tone> = {
  pending: "muted",
  in_progress: "accent",
  done: "success",
  blocked: "warning",
};

/** Badge tone for a decision: goal actions follow the goal status they left behind. */
export function decisionTone(d: DecisionEntry): Tone {
  if (d.kind === "judge_error") return "warning";
  if (d.kind !== "goal_action") return "muted";
  const status = d.data?.status;
  return status === "running" ? "accent" : status === "met" ? "success" : "warning";
}
