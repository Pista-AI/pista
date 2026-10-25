import { useState } from "react";
import { Target } from "lucide-react";
import type { GoalState } from "@pista/protocol";
import { actions, toast, useApp } from "../lib/store.ts";
import { fmtTokens } from "../lib/format.ts";
import { GOAL_TONE } from "../lib/tones.ts";

const STATUS_LABEL: Record<GoalState["status"], string> = {
  running: "Running",
  paused: "Paused",
  met: "Goal met",
  impossible: "Impossible",
  budget_exhausted: "Budget used up",
  no_progress: "No progress",
};

export function GoalChip({ threadId, goal }: { threadId: string; goal: GoalState }) {
  const detail = goal.pausedReason ?? goal.lastVerdict;
  const tokens = `${fmtTokens(goal.tokensUsed)}${goal.maxTokens ? `/${fmtTokens(goal.maxTokens)}` : ""} tokens`;
  return (
    <div className="above-composer">
      <button
        className={`goal-chip tone-${GOAL_TONE[goal.status]}`}
        title={[goal.text, goal.check ? `check: ${goal.check}` : undefined, detail, goal.cacheReadTokens ? `${fmtTokens(goal.tokensUsed)} tokens billed, of which ${fmtTokens(goal.cacheReadTokens)} cache reads` : undefined].filter(Boolean).join("\n\n")}
        onClick={() => useApp.setState({ goalDialog: threadId })}
      >
        <Target size={13} />
        <span className="goal-text ellipsis">{goal.text}</span>
        <span
          className="goal-status why-link"
          role="link"
          title="Why? Open the decisions behind this status"
          onClick={(e) => {
            e.stopPropagation();
            actions.showWhy(threadId);
          }}
        >
          {STATUS_LABEL[goal.status]}
        </span>
        <span className="goal-meta">
          {goal.turns}/{goal.maxTurns} turns · {tokens}
        </span>
      </button>
    </div>
  );
}

export function GoalDialog() {
  const threadId = useApp((s) => s.goalDialog);
  const goal = useApp((s) => (threadId ? s.views[threadId]?.goal : undefined));
  if (!threadId) return null;
  return <GoalForm key={threadId} threadId={threadId} goal={goal} onClose={() => useApp.setState({ goalDialog: null })} />;
}

function GoalForm({ threadId, goal, onClose }: { threadId: string; goal?: GoalState; onClose: () => void }) {
  const [text, setText] = useState(goal?.text ?? "");
  const [maxTurns, setMaxTurns] = useState(String(goal?.maxTurns ?? 25));
  const [maxTokens, setMaxTokens] = useState(goal?.maxTokens ? String(goal.maxTokens) : "");
  const [check, setCheck] = useState(goal?.check ?? "");
  const [replanEvery, setReplanEvery] = useState(goal?.replanEvery ? String(goal.replanEvery) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await actions.setGoal(threadId, text.trim(), Number(maxTurns) || 25, maxTokens ? Number(maxTokens) : undefined, check.trim() || undefined, replanEvery ? Number(replanEvery) : undefined);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <h3 style={{ margin: 0 }}>{goal ? "Edit goal" : "Set goal"}</h3>
        <p className="sub" style={{ margin: 0, color: "var(--text-3)" }}>
          The agent keeps working turn after turn until a judge decides the goal is met, or a budget runs out.
          {goal ? " Saving replaces the current goal and restarts its counters." : ""}
        </p>
        <div className="field" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <textarea autoFocus placeholder="What should be true when this is done?" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1, borderBottom: 0 }}>
            <label>Max turns</label>
            <input type="number" min={1} value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, borderBottom: 0 }}>
            <label>Max tokens, cache reads included (optional)</label>
            <input type="number" min={1} placeholder="No limit" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <label>Acceptance check command (optional)</label>
          <input placeholder="e.g. pnpm test. Exit code 0 means the goal is met" value={check} onChange={(e) => setCheck(e.target.value)} />
        </div>
        <div className="field" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <label>Replan every N turns (blank = only when stalled)</label>
          <input type="number" min={1} placeholder="Only when stalled" value={replanEvery} onChange={(e) => setReplanEvery(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="pill-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="pill-btn primary" disabled={!text.trim() || busy} onClick={save}>
            Save goal
          </button>
        </div>
      </div>
    </div>
  );
}
