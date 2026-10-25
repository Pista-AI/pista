import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ClipboardList,
  Scale,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  House,
  MessageCircle,
  Pin,
  PinOff,
  Plug,
  Search,
  Settings,
  SquarePen,
  ShieldQuestion,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type { ThreadSummary } from "@pista/protocol";
import { RoleBadge } from "./RoleBadge.tsx";
import { actions, childrenOf, toast, useApp } from "../lib/store.ts";
import { AddProjectDialog } from "./AddProjectDialog.tsx";
import { MenuItem, Popover } from "./Popover.tsx";

const COLLAPSED_LIMIT = 5;

/** Narrow icon rail on the far left, as in the Codex app. */
export function Rail({ onPointerEnter, onPointerLeave }: { onPointerEnter?: () => void; onPointerLeave?: () => void } = {}) {
  const { info, panel, sidebarOpen } = useApp();
  const initial = (info?.homeDir.split("/").pop() ?? "?").charAt(0).toUpperCase();
  const tabActive = (id: string) => panel.open && panel.activeId === id;
  const plan = useApp((s) => (s.activeThreadId ? s.views[s.activeThreadId]?.plan : undefined));
  const planDone = plan?.steps.filter((s) => s.status === "done").length ?? 0;
  // Badge: decisions logged since the Decisions tab was last open for this thread.
  const unseenDecisions = useApp((s) => {
    const id = s.activeThreadId;
    return id ? Math.max(0, (s.views[id]?.decisions.length ?? 0) - (s.decisionsSeen[id] ?? 0)) : 0;
  });
  return (
    <nav className="rail" onMouseEnter={onPointerEnter} onMouseLeave={onPointerLeave}>
      <button className={`rail-btn ${sidebarOpen ? "on" : ""}`} title="Threads" onClick={() => actions.setSidebar(true)}>
        <House size={18} />
      </button>
      <button className="rail-btn" title="New browser tab" onClick={() => actions.newWebTab()}>
        <Globe size={18} />
      </button>
      <button className={`rail-btn ${tabActive("terminal") ? "on" : ""}`} title="Terminal" onClick={() => actions.openPanelTab("terminal")}>
        <SquareTerminal size={18} />
      </button>
      <button className={`rail-btn ${tabActive("tools") ? "on" : ""}`} title="Tools" onClick={() => actions.openPanelTab("tools")}>
        <Wrench size={18} />
      </button>
      <button
        className={`rail-btn ${tabActive("plan") ? "on" : ""}`}
        title={plan ? `Plan (${planDone}/${plan.steps.length} done)` : "Plan"}
        style={{ position: "relative" }}
        onClick={() => actions.openPanelTab("plan")}
      >
        <ClipboardList size={18} />
        {plan && plan.steps.length > 0 && (
          <span style={{ position: "absolute", right: 1, bottom: 1, fontSize: 9, lineHeight: 1, padding: "2px 3px", borderRadius: 6, background: "var(--primary)", color: "var(--primary-fg)" }}>
            {planDone}/{plan.steps.length}
          </span>
        )}
      </button>
      <button
        className={`rail-btn ${tabActive("decisions") ? "on" : ""}`}
        title={unseenDecisions ? `Decisions (${unseenDecisions} new)` : "Decisions"}
        style={{ position: "relative" }}
        onClick={() => actions.openPanelTab("decisions")}
      >
        <Scale size={18} />
        {unseenDecisions > 0 && (
          <span style={{ position: "absolute", right: 1, bottom: 1, fontSize: 9, lineHeight: 1, padding: "2px 3px", borderRadius: 6, background: "var(--primary)", color: "var(--primary-fg)" }}>
            {unseenDecisions > 99 ? "99+" : unseenDecisions}
          </span>
        )}
      </button>
      <button className="rail-btn" title="Connections" onClick={() => useApp.setState({ settingsOpen: "mcp" })}>
        <Plug size={18} />
      </button>
      <div style={{ flex: 1 }} />
      <button className="rail-btn" title="Settings (⌘,)" onClick={() => useApp.setState({ settingsOpen: "general" })}>
        <Settings size={18} />
      </button>
      <div className="avatar" title={info?.homeDir}>
        {initial}
      </div>
    </nav>
  );
}

export function Sidebar() {
  const { projects, threads, activeThreadId, connected, info, pinned } = useApp();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);

  // Escape or a click outside the confirming row cancels the removal.
  useEffect(() => {
    if (!confirmingRemove) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirmingRemove(null);
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest("[data-confirming-remove]")) setConfirmingRemove(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [confirmingRemove]);

  const visible = useMemo(() => {
    const q = query?.trim().toLowerCase();
    return q ? threads.filter((t) => t.title.toLowerCase().includes(q)) : threads;
  }, [threads, query]);

  const pinnedThreads = visible.filter((t) => pinned.includes(t.id));
  const byProject = useMemo(() => {
    const map = new Map<string, ThreadSummary[]>();
    for (const p of projects) map.set(p.id, []);
    const ids = new Set(visible.map((t) => t.id));
    // Children nest under their parent; a child whose parent is missing falls back to top level.
    for (const t of visible) if (!pinned.includes(t.id) && !(t.parentId && ids.has(t.parentId))) map.get(t.projectId)?.push(t);
    return map;
  }, [projects, visible, pinned]);
  const unpinned = useMemo(() => visible.filter((t) => !pinned.includes(t.id)), [visible, pinned]);
  const withChildren = (t: ThreadSummary, props: { pinned?: boolean; nested?: boolean; icon?: boolean }) => (
    <div key={t.id}>
      <ThreadRow thread={t} active={t.id === activeThreadId} {...props} />
      {childrenOf(unpinned, t.id).map((c) => (
        <ThreadRow key={c.id} thread={c} active={c.id === activeThreadId} child />
      ))}
    </div>
  );

  return (
    <aside className="sidebar card">
      <div className="sidebar-head">
        <Popover
          placement="bottom-start"
          trigger={({ toggle }) => (
            <button className="brand" onClick={toggle}>
              Pista <ChevronDown size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<SquarePen size={15} />} onClick={() => (close(), actions.newThread())}>
                New thread
              </MenuItem>
              <MenuItem icon={<FolderPlus size={15} />} onClick={() => (close(), setAdding(true))}>
                Add project folder…
              </MenuItem>
              <div className="menu-sep" />
              <MenuItem icon={<Settings size={15} />} onClick={() => (close(), useApp.setState({ settingsOpen: "general" }))}>
                Settings
              </MenuItem>
            </>
          )}
        </Popover>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" title="Search threads" onClick={() => setQuery(query === null ? "" : null)}>
          <Search size={16} />
        </button>
      </div>

      {query !== null && (
        <div className="sidebar-search">
          <Search size={14} />
          <input autoFocus placeholder="Search threads" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery(null)} />
          <button className="icon-btn sm" onClick={() => setQuery(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      <div className="sidebar-scroll">
        <button className="side-item" onClick={() => actions.newThread()}>
          <SquarePen size={16} /> New thread
        </button>

        {pinnedThreads.length > 0 && (
          <>
            <div className="side-label">Pinned</div>
            {pinnedThreads.map((t) => withChildren(t, { pinned: true, icon: true }))}
          </>
        )}

        <div className="side-label">
          Projects
          <button className="icon-btn sm" title="Add project folder" onClick={() => setAdding(true)}>
            <FolderPlus size={14} />
          </button>
        </div>
        {projects.map((project) => {
          const list = byProject.get(project.id) ?? [];
          const isCollapsed = collapsed[project.id];
          const shown = expanded[project.id] ? list : list.slice(0, COLLAPSED_LIMIT);
          return (
            <div key={project.id}>
              {confirmingRemove === project.id ? (
                <div className="side-item folder confirm-remove" data-confirming-remove>
                  <span className="ellipsis">Remove? Files stay on disk.</span>
                  <button
                    className="pill-btn danger"
                    onClick={() => {
                      setConfirmingRemove(null);
                      actions.removeProject(project.id).catch((e: Error) => toast(e.message, "error"));
                    }}
                  >
                    Remove
                  </button>
                  <button className="pill-btn" onClick={() => setConfirmingRemove(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="side-item folder" title={project.path}>
                  <button className="folder-toggle" onClick={() => setCollapsed((c) => ({ ...c, [project.id]: !c[project.id] }))}>
                    {isCollapsed ? <Folder size={16} /> : <FolderOpen size={16} />}
                    <span className="ellipsis">{project.name}</span>
                  </button>
                  <button className="icon-btn sm hover-only" title="New thread in project" onClick={() => actions.newThread(project.id)}>
                    <SquarePen size={14} />
                  </button>
                  <button
                    className="icon-btn sm hover-only"
                    title="Remove project from sidebar"
                    aria-label="Remove project from sidebar"
                    onClick={() => setConfirmingRemove(project.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
              {!isCollapsed && (
                <>
                  {shown.map((t) => withChildren(t, { nested: true }))}
                  {list.length > COLLAPSED_LIMIT && (
                    <button className="side-item nested muted" onClick={() => setExpanded((e) => ({ ...e, [project.id]: !e[project.id] }))}>
                      {expanded[project.id] ? "Show less" : "Show more"}
                    </button>
                  )}
                  {list.length === 0 && !query && <div className="side-item nested muted static">No threads yet</div>}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className={`conn ${connected ? "" : "off"}`}>
        <i /> {connected ? `Pi ${info?.piVersion ?? ""} · host connected` : "Host disconnected"}
      </div>

      {adding && <AddProjectDialog onClose={() => setAdding(false)} />}
    </aside>
  );
}

function ThreadRow({
  thread,
  active,
  pinned,
  nested,
  icon,
  child,
}: {
  thread: ThreadSummary;
  active: boolean;
  pinned?: boolean;
  nested?: boolean;
  icon?: boolean;
  child?: boolean;
}) {
  const unread = useApp((s) => s.unread[thread.id]);
  const needsApproval = useApp((s) => s.approvals.some((a) => a.threadId === thread.id));
  return (
    <div className={`side-item thread ${active ? "active" : ""} ${nested ? "nested" : ""} ${child ? "child" : ""}`} onClick={() => actions.openThread(thread.id)}>
      {icon && <MessageCircle size={15} className="lead" />}
      {child && thread.role && <RoleBadge role={thread.role} />}
      <span className="ellipsis">{thread.title}</span>
      <span className="row-actions">
        <button
          className="icon-btn sm"
          title={pinned ? "Unpin" : "Pin"}
          onClick={(e) => {
            e.stopPropagation();
            actions.togglePin(thread.id);
          }}
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button
          className="icon-btn sm"
          title="Archive"
          onClick={(e) => {
            e.stopPropagation();
            void actions.archive(thread.id);
          }}
        >
          <Archive size={13} />
        </button>
      </span>
      <span className="row-status">
        {needsApproval && <ShieldQuestion size={14} className="approval-flag" aria-label="Needs approval" />}
        {thread.status === "running" ? <span className="spinner" /> : thread.status === "error" ? <span className="dot-error" /> : unread ? <span className="dot-unread" /> : null}
      </span>
    </div>
  );
}
