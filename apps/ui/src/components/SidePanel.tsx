import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Check,
  Circle,
  ClipboardList,
  Scale,
  CloudOff,
  Bot,
  ExternalLink,
  FileDiff,
  Info,
  Globe,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRightClose,
  Plus,
  RotateCw,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import { browser, dismissNotice, hostLabel, loadErrorHint, useBrowser } from "../browser/controller.ts";
import type { PlanStepStatus } from "@pista/protocol";
import { actions, type PanelTab, toast, useApp } from "../lib/store.ts";
import { host } from "../lib/host.ts";
import { computeChanges } from "../lib/changes.ts";
import { openExternal } from "../lib/links.ts";
import { STEP_TONE } from "../lib/tones.ts";
import { DecisionsView } from "./DecisionsView.tsx";

/** Right-hand workspace. In split and maximized modes App renders `WorkspaceTabs` in the title row and
 *  this component only supplies the body card. As a drawer it also carries its own tab strip, with the
 *  body kept at the same child position so web tabs never remount when the mode switches. */
export function Workspace({ drawerWidth }: { drawerWidth?: number }) {
  return (
    <section className={`workspace ${drawerWidth ? "drawer" : ""}`} style={drawerWidth ? { width: drawerWidth } : undefined}>
      {drawerWidth ? <WorkspaceTabs /> : null}
      <WorkspaceBody />
    </section>
  );
}

/** The tab strip plus panel controls. `lead` (nav buttons) is shown first when the sidebar is closed. */
export function WorkspaceTabs({ lead, underTraffic }: { lead?: ReactNode; underTraffic?: boolean }) {
  const panel = useApp((s) => s.panel);
  return (
    <div className={`tb-panel drag ${lead ? "has-nav" : ""} ${underTraffic ? "under-traffic" : ""}`}>
      {lead}
      <div className="tabs no-drag" role="tablist">
        {panel.tabs.map((t) => (
          <TabButton key={t.id} tab={t} active={t.id === panel.activeId} />
        ))}
      </div>
      <button className="icon-btn sm tab-new no-drag" title="New browser tab" aria-label="New browser tab" onClick={() => actions.newWebTab()}>
        <Plus size={15} />
      </button>
      <div style={{ flex: 1 }} />
      <button
        className="icon-btn no-drag"
        title={panel.maximized ? "Restore chat" : "Expand panel"}
        onClick={() => useApp.setState((s) => ({ panel: { ...s.panel, maximized: !s.panel.maximized } }))}
      >
        {panel.maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
      <button className="icon-btn no-drag" title="Hide panel (⌘J)" onClick={() => actions.togglePanel()}>
        <PanelRightClose size={16} />
      </button>
    </div>
  );
}

function WorkspaceBody() {
  const panel = useApp((s) => s.panel);
  const active = panel.tabs.find((t) => t.id === panel.activeId);
  const webTabs = panel.tabs.filter((t) => t.kind === "web");
  return (
    <>
      {/* Web tabs stay mounted so pages keep their state across tab switches. */}
      <div style={{ display: active?.kind === "web" ? "flex" : "none" }} className="workspace-body">
        <BrowserView webTabIds={webTabs.map((t) => t.id)} activeId={active?.kind === "web" ? active.id : null} />
      </div>
      {active?.kind === "terminal" && <TerminalView />}
      {active?.kind === "tools" && <ToolsView />}
      {active?.kind === "changes" && <ChangesView />}
      {active?.kind === "plan" && <PlanView />}
      {active?.kind === "decisions" && <DecisionsView />}
      {!active && <div className="workspace-empty">Open a browser tab with + or from the rail.</div>}
    </>
  );
}

function TabButton({ tab, active }: { tab: PanelTab; active: boolean }) {
  const web = useBrowser((s) => (tab.kind === "web" ? s.tabs[tab.id] : undefined));
  const meta: Record<Exclude<PanelTab["kind"], "web">, { label: string; Icon: typeof Globe }> = {
    terminal: { label: "Terminal", Icon: SquareTerminal },
    tools: { label: "Tools", Icon: Wrench },
    changes: { label: "Changes", Icon: FileDiff },
    plan: { label: "Plan", Icon: ClipboardList },
    decisions: { label: "Decisions", Icon: Scale },
  };
  const { label, Icon } = tab.kind === "web" ? { label: web?.title || hostLabel(web?.url ?? "") || "New tab", Icon: Globe } : meta[tab.kind];
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-tab-id={tab.id}
      data-kind={tab.kind}
      className={`ptab ${active ? "on" : ""}`}
      onClick={() => actions.activatePanelTab(tab.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          actions.activatePanelTab(tab.id);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const all = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
          const i = all.indexOf(e.currentTarget);
          const next = all[(i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length];
          if (next?.dataset.tabId) actions.activatePanelTab(next.dataset.tabId);
          next?.focus();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          actions.closePanelTab(tab.id);
        }
      }}
      title={web?.url ?? label}
    >
      {web?.loading ? <span className="spinner" /> : <Icon size={14} />}
      <span className="ellipsis">{label}</span>
      <button
        className="ptab-close"
        tabIndex={-1}
        aria-label={`Close ${label}`}
        title="Close tab"
        onClick={(e) => {
          e.stopPropagation();
          actions.closePanelTab(tab.id);
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function BrowserView({ webTabIds, activeId }: { webTabIds: string[]; activeId: string | null }) {
  const tabs = useBrowser((s) => s.tabs);
  const native = useBrowser((s) => s.native);
  const agentActivity = useBrowser((s) => s.agentActivity);
  const notice = useBrowser((s) => s.notice);
  const tab = activeId ? tabs[activeId] : undefined;
  const [input, setInput] = useState(tab?.url ?? "");
  const [editing, setEditing] = useState(false);
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => setInput(tab?.url ?? ""), [tab?.url]);

  // Native shells render a real webview over this placeholder. The native view is drawn
  // above the page, so it is hidden while a modal is open and re-synced when layout moves.
  useLayoutEffect(() => {
    const bridge = window.pistaDesktop?.browser;
    const el = surface.current;
    if (!bridge || !el) return;
    let last = "";
    const report = () => {
      const r = el.getBoundingClientRect();
      // The native view draws above the page: hide it for modals and for our error page.
      const blocked = Boolean(document.querySelector(".overlay, .load-error"));
      const rect = activeId && !blocked && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      const key = JSON.stringify(rect);
      if (key === last) return;
      last = key;
      bridge.setBounds(rect);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    const mo = new MutationObserver(report);
    mo.observe(document.body, { childList: true, subtree: true });
    const timer = setInterval(report, 250);
    window.addEventListener("resize", report);
    return () => {
      ro.disconnect();
      mo.disconnect();
      clearInterval(timer);
      window.removeEventListener("resize", report);
      bridge.setBounds(null);
    };
  }, [activeId]);

  const canBack = Boolean(tab && tab.cursor > 0);
  const canForward = Boolean(tab && tab.cursor < tab.history.length - 1);

  return (
    <>
      <div className="browser-toolbar">
        <div className="nav-group">
          <button className="icon-btn" disabled={!canBack} onClick={() => activeId && browser.back(activeId)} title="Back">
            <ArrowLeft size={16} />
          </button>
          <button className="icon-btn" disabled={!canForward} onClick={() => activeId && browser.forward(activeId)} title="Forward">
            <ArrowRight size={16} />
          </button>
          <span className="nav-sep" />
          <button className="icon-btn" onClick={() => activeId && browser.reload(activeId)} title="Reload">
            <RotateCw size={15} />
          </button>
        </div>
        <button
          className="toolbar-pill"
          title="Reference this page in your next message"
          disabled={!tab}
          onClick={() => tab && useApp.setState({ pageContext: { url: tab.url, title: tab.title } })}
        >
          <MessageSquarePlus size={15} /> <span className="txt">Add to chat</span>
        </button>
        <form
          className="url-pill"
          onSubmit={(e) => {
            e.preventDefault();
            if (activeId) void browser.navigate(activeId, input);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <input
            value={editing ? input : tab ? hostLabel(tab.url) : ""}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              setInput(tab?.url ?? "");
              requestAnimationFrame(() => e.target.select());
            }}
            onBlur={() => setEditing(false)}
            spellCheck={false}
            placeholder="Search or enter address"
          />
        </form>
        <button
          className="icon-btn outlined"
          title="Open in system browser"
          disabled={!tab}
          onClick={() => tab && openExternal(tab.url)}
        >
          <ExternalLink size={15} />
        </button>
      </div>
      <div className="browser-surface" ref={surface}>
        {tab?.loading && <div className="loading-bar" />}
        {!native &&
          webTabIds.map((id) => {
            const t = tabs[id];
            if (!t) return null;
            return (
              <iframe
                key={`${id}-${t.nonce}`}
                ref={(el) => browser.attachIframe(id, el)}
                src={t.url}
                title={t.title || t.url}
                style={{ display: id === activeId ? "block" : "none" }}
                onLoad={() => browser.onIframeLoad(id)}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              />
            );
          })}
        {tab?.error && !tab.loading && (
          <div className="load-error">
            <CloudOff size={28} />
            <h4>Can't reach {hostLabel(tab.error.url)}</h4>
            <p>{loadErrorHint(tab.error.description)}</p>
            <code>{tab.error.description}</code>
            <div className="btn-row">
              <button className="pill-btn" onClick={() => openExternal(tab.error!.url)}>
                Open in browser
              </button>
              <button className="pill-btn primary" onClick={() => activeId && browser.navigate(activeId, tab.error!.url)}>
                Retry
              </button>
            </div>
          </div>
        )}
        {notice && notice.tabId === activeId && (
          <div className="browser-notice" role="status">
            <Info size={15} />
            <span>
              {notice.message} <span className="hint">The desktop app has full access.</span>
            </span>
            {notice.url && (
              <button className="pill-btn" onClick={() => openExternal(notice.url!)}>
                Open
              </button>
            )}
            <button className="icon-btn sm" title="Dismiss" onClick={dismissNotice}>
              <X size={13} />
            </button>
          </div>
        )}
        {agentActivity && (
          <div className="agent-badge">
            <Bot size={13} /> {agentActivity}
          </div>
        )}
      </div>
    </>
  );
}

function TerminalView() {
  const threadId = useApp((s) => s.activeThreadId);
  const [lines, setLines] = useState<{ cmd: string; out: string; code?: number }[]>([]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const out = useRef<HTMLDivElement>(null);

  useEffect(() => {
    out.current?.scrollTo(0, out.current.scrollHeight);
  }, [lines]);

  const run = async () => {
    if (!threadId || !cmd.trim()) return;
    const command = cmd;
    setCmd("");
    setBusy(true);
    try {
      const res = await host.call("thread.bash", { threadId, command });
      setLines((l) => [...l, { cmd: command, out: res.output, code: res.exitCode }]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-body">
      <div className="terminal">
        <div className="out" ref={out}>
          {!threadId && <span style={{ color: "var(--text-3)" }}>Open a thread to run commands in its project folder.</span>}
          {threadId && lines.length === 0 && (
            <span style={{ color: "var(--text-3)" }}>Commands run in the thread's project folder and their output is shared with the agent.</span>
          )}
          {lines.map((l, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ color: "var(--text-2)" }}>$ {l.cmd}</div>
              <div>{l.out}</div>
              {l.code ? <div style={{ color: "var(--red)" }}>exit {l.code}</div> : null}
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <span style={{ color: "var(--text-3)" }}>$</span>
          <input disabled={!threadId || busy} value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={busy ? "Running…" : "Type a command"} />
        </form>
      </div>
    </div>
  );
}

function ToolsView() {
  const view = useApp((s) => (s.activeThreadId ? s.views[s.activeThreadId] : undefined));
  if (!view) return <div className="workspace-empty">Open a thread to see its tools.</div>;
  const groups = new Map<string, typeof view.tools>();
  for (const t of view.tools) {
    const g = t.namespace ?? (t.name.startsWith("browser_") ? "browser" : "built-in");
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  return (
    <div className="workspace-body scroll tool-list">
      {[...groups.entries()].map(([group, tools]) => (
        <div key={group}>
          <div className="group">
            {group} · {tools.length}
          </div>
          {tools.map((t) => (
            <div className="tool-item" key={t.name}>
              <div className="n">
                {t.name}
                {t.active ? <span className="badge">active</span> : t.exposure && <span className="badge">{t.exposure}</span>}
              </div>
              <div className="d">{t.description}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ChangesView() {
  const messages = useApp((s) => (s.activeThreadId ? s.views[s.activeThreadId]?.messages : undefined));
  const changes = useMemo(() => computeChanges(messages ?? []), [messages]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (changes.length === 0) return <div className="workspace-empty">No file changes in this thread yet.</div>;
  return (
    <div className="workspace-body scroll changes">
      {changes.map((c) => (
        <div key={c.path} className="change-file">
          <button className="change-head" onClick={() => setOpen((o) => ({ ...o, [c.path]: !o[c.path] }))}>
            <span className="ellipsis mono">{c.path}</span>
            <span className="add">+{c.added}</span>
            <span className="del">-{c.removed}</span>
          </button>
          {open[c.path] && (
            <div className="step-detail" style={{ margin: "0 0 8px", maxHeight: "none" }}>
              {c.hunks.map((h, i) => (
                <div className="sect" key={i}>
                  {h.text.split("\n").map((line, j) => (
                    <div
                      key={j}
                      className={`diff-line ${h.kind === "write" || (line.startsWith("+") && !line.startsWith("+++")) ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : ""}`}
                    >
                      {line || " "}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const STEP_ICON: Record<PlanStepStatus, { Icon: typeof Circle; spin?: boolean }> = {
  pending: { Icon: Circle },
  in_progress: { Icon: Loader2, spin: true },
  done: { Icon: Check },
  blocked: { Icon: AlertTriangle },
};

function PlanView() {
  const plan = useApp((s) => (s.activeThreadId ? s.views[s.activeThreadId]?.plan : undefined));
  if (!plan || plan.steps.length === 0) {
    return <div className="workspace-empty">No plan yet. The agent creates one with the plan tool for multi-step work.</div>;
  }
  const done = plan.steps.filter((s) => s.status === "done").length;
  return (
    <div className="workspace-body scroll tool-list">
      <div className="group">
        Plan · {done}/{plan.steps.length} done
      </div>
      {plan.steps.map((step) => {
        const { Icon, spin } = STEP_ICON[step.status];
        return (
          <div className="tool-item" key={step.id} data-status={step.status}>
            <div className="n" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon size={14} className={`tone-${STEP_TONE[step.status]}`} style={spin ? { animation: "spin 1s linear infinite", flexShrink: 0 } : { flexShrink: 0 }} />
              <span style={{ color: "var(--text-3)" }}>{step.id}</span>
              <span style={step.status === "done" ? { color: "var(--text-2)", textDecoration: "line-through" } : undefined}>{step.title}</span>
              {step.dependsOn && step.dependsOn.length > 0 && (
                <span style={{ color: "var(--text-3)", fontWeight: 400 }}>after {step.dependsOn.join(", ")}</span>
              )}
            </div>
            {step.note && <div className="d">{step.note}</div>}
          </div>
        );
      })}
    </div>
  );
}
