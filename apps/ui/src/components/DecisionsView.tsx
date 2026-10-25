import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DecisionEntry, DecisionKind } from "@pista/protocol";
import { useApp } from "../lib/store.ts";
import { decisionTone } from "../lib/tones.ts";

type Group = "goal" | "plan" | "agents" | "judge";

const GROUPS: { id: Group; label: string }[] = [
  { id: "goal", label: "Goal" },
  { id: "plan", label: "Plan" },
  { id: "agents", label: "Sub-agents" },
  { id: "judge", label: "Judge" },
];

const GROUP_OF: Record<DecisionKind, Group> = {
  goal_action: "goal",
  replan: "plan",
  plan_change: "plan",
  agent_dispatch: "agents",
  agent_result: "agents",
  goal_verdict: "judge",
  judge_error: "judge",
};

const KIND_LABEL: Record<DecisionKind, string> = {
  goal_verdict: "verdict",
  goal_action: "goal",
  plan_change: "plan",
  agent_dispatch: "dispatch",
  agent_result: "result",
  replan: "replan",
  judge_error: "judge error",
};

const EMPTY = "No decisions yet. Goal verdicts, plan changes and sub-agent dispatches appear here with their reasons.";
const NEAR_BOTTOM = 40;
const CLAMP_CHARS = 400;

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function fmtValue(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Timeline of why the agent did what it did: newest at the bottom, like the chat. */
export function DecisionsView() {
  const threadId = useApp((s) => s.activeThreadId);
  const decisions = useApp((s) => (s.activeThreadId ? s.views[s.activeThreadId]?.decisions : undefined));
  const focusId = useApp((s) => s.decisionFocus);
  const [hidden, setHidden] = useState<Record<Group, boolean>>({ goal: false, plan: false, agents: false, judge: false });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const count = decisions?.length ?? 0;

  // Opening the tab, or new entries arriving while it is open, mark everything as seen.
  useEffect(() => {
    if (threadId) useApp.setState((s) => (s.decisionsSeen[threadId] === count ? s : { decisionsSeen: { ...s.decisionsSeen, [threadId]: count } }));
  }, [threadId, count]);

  useEffect(() => () => useApp.setState({ decisionFocus: null }), []);

  // Follow new entries only when the user is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current && !focusId) el.scrollTop = el.scrollHeight;
  }, [count, focusId]);

  // "why?" on the goal chip: reveal, expand and scroll to the requested entry.
  useLayoutEffect(() => {
    if (!focusId) return;
    const target = decisions?.find((d) => d.id === focusId);
    if (target) {
      setHidden((h) => ({ ...h, [GROUP_OF[target.kind]]: false }));
      setOpen((o) => ({ ...o, [focusId]: true }));
      requestAnimationFrame(() => scroller.current?.querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "center" }));
    }
    // Keep the highlight until the user focuses something else.
  }, [focusId, decisions]);

  if (!decisions) return <div className="workspace-empty">Open a thread to see its decisions.</div>;
  const shown = decisions.filter((d) => !hidden[GROUP_OF[d.kind]]);

  return (
    <div
      className="workspace-body scroll decisions"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
      }}
    >
      {decisions.length === 0 ? (
        <div className="workspace-empty">{EMPTY}</div>
      ) : (
        <>
          <div className="decision-filters">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                className={`badge ${hidden[g.id] ? "" : "on"}`}
                aria-pressed={!hidden[g.id]}
                onClick={() => setHidden((h) => ({ ...h, [g.id]: !h[g.id] }))}
              >
                {g.label}
              </button>
            ))}
          </div>
          {shown.length === 0 && <div className="workspace-empty">Every kind is filtered out.</div>}
          {shown.map((d) => (
            <DecisionRow
              key={d.id}
              decision={d}
              open={Boolean(open[d.id])}
              focused={d.id === focusId}
              onToggle={() => setOpen((o) => ({ ...o, [d.id]: !o[d.id] }))}
            />
          ))}
        </>
      )}
    </div>
  );
}

function DecisionRow({ decision: d, open, focused, onToggle }: { decision: DecisionEntry; open: boolean; focused: boolean; onToggle: () => void }) {
  const data = d.data ? Object.entries(d.data) : [];
  return (
    <div className={`decision ${focused ? "focus" : ""}`} data-id={d.id}>
      <button className="decision-head" aria-expanded={open} onClick={onToggle}>
        <span className="time">{fmtTime(d.ts)}</span>
        <span className={`badge tone-${decisionTone(d)}`}>{KIND_LABEL[d.kind]}</span>
        <span>{d.summary}</span>
      </button>
      {open && (
        <div className="decision-body">
          {d.reason && (
            <div>
              <div className="label">Why</div>
              {d.reason}
            </div>
          )}
          {d.evidence && <Evidence text={d.evidence} />}
          {data.length > 0 && (
            <div className="decision-data">
              {data.map(([k, v]) => (
                <span key={k} style={{ display: "contents" }}>
                  <span className="k">{k}</span>
                  <span className="v">{fmtValue(v)}</span>
                </span>
              ))}
            </div>
          )}
          {!d.reason && !d.evidence && data.length === 0 && <div className="label">No further detail recorded.</div>}
        </div>
      )}
    </div>
  );
}

function Evidence({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const long = text.split("\n").length > 6 || text.length > CLAMP_CHARS;
  return (
    <div>
      <div className="label">Evidence</div>
      <pre className={long && !full ? "clamped" : ""}>{text}</pre>
      {long && (
        <button className="more" onClick={() => setFull((f) => !f)}>
          {full ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}
