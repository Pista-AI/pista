import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Database,
  Ellipsis,
  FolderOpen,
  Globe,
  Pause,
  Play,
  Target,
  X,
  PanelLeft,
  PanelRight,
  PencilLine,
  Pin,
  Shrink,
  WandSparkles,
} from "lucide-react";
import { actions, threadById, toast, useApp } from "./lib/store.ts";

const RAIL_WIDTH = 52; // mirrors --rail-w in styles.css
/** Outer inset around the pane group (the single source for --g; set inline on .app below).
 *  Panes are flush, so there is no gutter between them: the divider is the 1px pane border. */
const GUTTER = 8;
/** Chat and panel at their 320px minimums plus the right-hand inset. */
const MIN_SPLIT = 320 + 320 + GUTTER;
/** macOS traffic lights only exist inside the desktop shell, not in a browser tab. */
const HAS_TRAFFIC_LIGHTS = Boolean(window.pistaDesktop) && /Mac/i.test(navigator.platform);
import { host } from "./lib/host.ts";
import { Rail, Sidebar } from "./components/Sidebar.tsx";
import { Transcript, UserBubble } from "./components/Transcript.tsx";
import { Composer } from "./components/Composer.tsx";
import { Workspace, WorkspaceTabs } from "./components/SidePanel.tsx";
import { SettingsDialog } from "./components/Settings.tsx";
import { AuthPromptDialog } from "./components/AuthPrompt.tsx";
import { GoalDialog } from "./components/GoalControls.tsx";
import { VersionBlock } from "./components/VersionBlock.tsx";
import { JobCard, JobFooter, JobStrip, useFocusedMode } from "./focused/Job.tsx";
import { MenuItem, Popover } from "./components/Popover.tsx";

const SUGGESTIONS = [
  { icon: Globe, text: "Find the cheapest flight from Copenhagen to Barcelona next month" },
  { icon: Database, text: "Summarize what's in this project folder and suggest next steps" },
  { icon: WandSparkles, text: "Open Hacker News and tell me what's worth reading today" },
];

export function App() {
  const { activeThreadId, threads, projects, views, panel, sidebarOpen, sidebarWidth, connected, toasts, draftProjectId, pinned, startingMessage, info, versionBlockMessage } = useApp();
  const focused = useFocusedMode();
  const gate = info?.versionGate;
  const blocked = (gate && gate.status !== "ok") || versionBlockMessage !== null;
  const thread = threadById(threads, activeThreadId);
  const parent = threadById(threads, thread?.parentId);
  const view = activeThreadId ? views[activeThreadId] : undefined;
  const project = projects.find((p) => p.id === (thread?.projectId ?? draftProjectId));
  const [seed, setSeed] = useState<{ text: string; n: number }>();
  const [renaming, setRenaming] = useState(false);
  const chatRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState<null | "split" | "sidebar">(null);

  // Focused mode starts with the sidebar out of the way.
  useEffect(() => {
    if (focused) actions.setSidebar(false);
  }, [focused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const keys: Record<string, () => void> = {
        n: () => actions.newThread(),
        b: () => actions.toggleSidebar(),
        j: () => actions.togglePanel(),
        t: () => actions.newWebTab(),
        ",": () => useApp.setState({ settingsOpen: "general" }),
        "[": () => void actions.navigate(-1),
        "]": () => void actions.navigate(1),
      };
      const run = keys[e.key];
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      if (dragging === "sidebar") {
        actions.setSidebarWidth(e.clientX - RAIL_WIDTH);
        return;
      }
      const left = chatRef.current?.getBoundingClientRect().left ?? 0;
      // Chat's right edge follows the cursor; the panel keeps 320px plus the right-hand inset.
      const chatWidth = Math.min(Math.max(e.clientX - left, 320), window.innerWidth - left - 320 - GUTTER);
      useApp.setState((s) => ({ panel: { ...s.panel, chatWidth } }));
    };
    const up = () => setDragging(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging]);

  const [winWidth, setWinWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Hover peek: with the sidebar toggled off, hovering the rail floats the sidebar over the chat.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const overRail = useRef(false);
  const overPeek = useRef(false);
  const suppressPeek = useRef(false);
  const clearPeekTimer = () => window.clearTimeout(peekTimer.current);
  const schedulePeek = (open: boolean, delay: number) => {
    clearPeekTimer();
    peekTimer.current = window.setTimeout(() => setPeek(open), delay);
  };
  const onPeekPointer = (kind: "rail" | "peek", inside: boolean) => {
    (kind === "rail" ? overRail : overPeek).current = inside;
    if (kind === "rail" && !inside) suppressPeek.current = false;
    if (sidebarOpen) return;
    if (inside) {
      if (suppressPeek.current) return;
      if (peek) clearPeekTimer();
      else if (kind === "rail") schedulePeek(true, 150);
    } else if (!overRail.current && !overPeek.current) {
      schedulePeek(false, 200);
    }
  };
  const wasSidebarOpen = useRef(sidebarOpen);
  useEffect(() => {
    if (sidebarOpen) {
      clearPeekTimer();
      setPeek(false);
    } else if (wasSidebarOpen.current) {
      // Just toggled off: do not pop the overlay while the pointer is still on the rail.
      suppressPeek.current = overRail.current;
      overPeek.current = false;
    }
    wasSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearPeekTimer();
        setPeek(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek]);
  useEffect(() => clearPeekTimer, []);
  const leftWidth = sidebarOpen ? RAIL_WIDTH + sidebarWidth : RAIL_WIDTH + GUTTER;
  // Too narrow for chat and panel side by side: the panel becomes a drawer over the chat.
  const overlay = panel.open && !panel.maximized && winWidth - leftWidth < MIN_SPLIT;
  const split = panel.open && !panel.maximized && !overlay;
  const maximized = panel.open && panel.maximized;
  const appVars = {
    "--g": `${GUTTER}px`,
    "--sidebar-w": `${sidebarOpen ? sidebarWidth : 0}px`,
    "--chat-w": `${panel.chatWidth}px`,
    "--sidebar-w-peek": `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <div className={`app ${sidebarOpen ? "has-sidebar" : ""} ${split ? "has-split" : ""} ${maximized ? "panel-max" : ""}`} style={appVars}>
      <header className="titlebar drag">
        <div className="tb-nav">
          {HAS_TRAFFIC_LIGHTS && <div className="traffic-space" />}
          {sidebarOpen && <NavButtons />}
        </div>
        {!maximized && (
          <div className={`tb-chat ${!sidebarOpen && HAS_TRAFFIC_LIGHTS ? "under-traffic" : ""}`}>
            {!sidebarOpen && <NavButtons />}
            <FolderOpen size={15} className="muted-icon" />
            {parent && (
              <button className="crumb no-drag" title={`Back to ${parent.title}`} onClick={() => void actions.openThread(parent.id)}>
                <ArrowLeft size={13} />
                <span className="ellipsis">{parent.title}</span>
              </button>
            )}
            {thread ? (
              renaming ? (
                <RenameInput
                  title={thread.title}
                  onDone={(title) => {
                    setRenaming(false);
                    if (title && title !== thread.title) void actions.rename(thread.id, title);
                  }}
                />
              ) : (
                <span className="t-title" onDoubleClick={() => setRenaming(true)} title={`${thread.title} · ${project?.name ?? ""}`}>
                  {thread.title}
                </span>
              )
            ) : (
              <span className="t-title">New thread</span>
            )}
            {thread && (
              <Popover
                placement="bottom-start"
                trigger={({ toggle }) => (
                  <button className="icon-btn no-drag" onClick={toggle} title="Thread actions">
                    <Ellipsis size={16} />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <div className="menu-label">{project?.name}</div>
                    <MenuItem icon={<PencilLine size={15} />} onClick={() => (close(), setRenaming(true))}>
                      Rename
                    </MenuItem>
                    <MenuItem icon={<Pin size={15} />} onClick={() => (close(), actions.togglePin(thread.id))}>
                      {pinned.includes(thread.id) ? "Unpin" : "Pin"}
                    </MenuItem>
                    <MenuItem
                      icon={<Shrink size={15} />}
                      description="Summarize older context to free up space"
                      onClick={() => {
                        close();
                        host.call("thread.compact", { threadId: thread.id }).catch((e: Error) => toast(e.message, "error"));
                      }}
                    >
                      Compact context
                    </MenuItem>
                    <div className="menu-sep" />
                    <MenuItem icon={<Target size={15} />} onClick={() => (close(), useApp.setState({ goalDialog: thread.id }))}>
                      {view?.goal ? "Edit goal…" : "Set goal…"}
                    </MenuItem>
                    {view?.goal?.status === "running" && (
                      <MenuItem icon={<Pause size={15} />} onClick={() => (close(), goalCall(actions.pauseGoal(thread.id)))}>
                        Pause goal
                      </MenuItem>
                    )}
                    {view?.goal?.status === "paused" && (
                      <MenuItem icon={<Play size={15} />} onClick={() => (close(), goalCall(actions.resumeGoal(thread.id)))}>
                        Resume goal
                      </MenuItem>
                    )}
                    {view?.goal && (
                      <MenuItem icon={<X size={15} />} onClick={() => (close(), goalCall(actions.clearGoal(thread.id)))}>
                        Clear goal
                      </MenuItem>
                    )}
                    <div className="menu-sep" />
                    <MenuItem icon={<Archive size={15} />} onClick={() => (close(), actions.archive(thread.id))}>
                      Archive
                    </MenuItem>
                  </>
                )}
              </Popover>
            )}
            <span className="spacer" />
            {!panel.open && (
              <button className="icon-btn no-drag" title="Show panel (⌘J)" onClick={() => actions.togglePanel()}>
                <PanelRight size={17} />
              </button>
            )}
          </div>
        )}
        {/* Tabs live in the title row in split and maximized modes; the drawer carries its own. */}
        {panel.open && !overlay && (
          <WorkspaceTabs
            lead={!sidebarOpen && maximized ? <NavButtons /> : undefined}
            underTraffic={!sidebarOpen && maximized && HAS_TRAFFIC_LIGHTS}
          />
        )}
      </header>

      <Rail onPointerEnter={() => onPeekPointer("rail", true)} onPointerLeave={() => onPeekPointer("rail", false)} />
      {sidebarOpen && <Sidebar />}
      {!sidebarOpen && peek && (
        <div
          className="sidebar-peek"
          onMouseEnter={() => onPeekPointer("peek", true)}
          onMouseLeave={() => onPeekPointer("peek", false)}
        >
          <Sidebar />
        </div>
      )}
      {sidebarOpen && (
        <div
          className="sidebar-resizer"
          title="Drag to resize · double-click to reset"
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging("sidebar");
          }}
          onDoubleClick={() => actions.setSidebarWidth(272)}
        />
      )}

      {!maximized && (
        <main className="chat card" ref={chatRef}>
          {blocked ? (
            <VersionBlock gate={gate} message={versionBlockMessage} />
          ) : thread && view ? (
            <>
              {focused && <JobStrip thread={thread} />}
              <Transcript view={view} threadId={thread.id} footer={focused ? <JobFooter thread={thread} view={view} /> : undefined} />
            </>
          ) : startingMessage?.role === "user" ? (
            <div className="transcript">
              <div className="transcript-inner">
                <UserBubble message={startingMessage} />
              </div>
            </div>
          ) : (
            <>
              <div className="empty">
                {focused ? <JobCard /> : <h1>What should we do today?</h1>}
                {!focused && (
                <Popover
                  placement="bottom-start"
                  trigger={({ toggle }) => (
                    <button className="project-picker" onClick={toggle}>
                      <FolderOpen size={16} /> {project?.name ?? "Choose project"} <ChevronDown size={15} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      {projects.map((p) => (
                        <MenuItem
                          key={p.id}
                          checked={p.id === project?.id}
                          description={p.path}
                          onClick={() => {
                            close();
                            actions.newThread(p.id);
                          }}
                        >
                          {p.name}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Popover>
                )}
              </div>
              {!focused && (
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s.text} className="suggestion" onClick={() => setSeed({ text: s.text, n: Date.now() })}>
                    <s.icon size={16} />
                    {s.text}
                  </button>
                ))}
              </div>
              )}
            </>
          )}
          {!blocked && <Composer autoFocusKey={activeThreadId ?? "new"} seed={seed} {...(focused ? { simple: true, tall: !thread, placeholder: thread ? "Reply here (for example: done)" : "Paste your transactions here" } : {})} />}
        </main>
      )}

      {panel.open && (
        <>
          {split && (
            <div
              className="split-resizer"
              onMouseDown={(e) => {
                e.preventDefault();
                setDragging("split");
              }}
            />
          )}
          <Workspace drawerWidth={overlay ? Math.max(Math.min(560, winWidth - leftWidth), 320) : undefined} />
        </>
      )}

      {dragging && <div className="drag-shield" />}

      <SettingsDialog />
      <AuthPromptDialog />
      <GoalDialog />
      {!connected && (
        <div className="disconnected">
          <span className="spinner" /> Connecting to agent host…
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

const goalCall = (p: Promise<unknown>) => p.catch((e: Error) => toast(e.message, "error"));

function NavButtons() {
  const { nav, sidebarOpen } = useApp();
  return (
    <div className="nav-buttons no-drag">
      <button className="icon-btn" title={sidebarOpen ? "Hide sidebar (⌘B)" : "Show sidebar (⌘B)"} onClick={() => actions.toggleSidebar()}>
        <PanelLeft size={16} />
      </button>
      <button className="icon-btn" title="Back (⌘[)" disabled={nav.index === 0} onClick={() => actions.navigate(-1)}>
        <ArrowLeft size={16} />
      </button>
      <button className="icon-btn" title="Forward (⌘])" disabled={nav.index >= nav.stack.length - 1} onClick={() => actions.navigate(1)}>
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

function RenameInput({ title, onDone }: { title: string; onDone: (title: string) => void }) {
  const [value, setValue] = useState(title);
  return (
    <input
      className="no-drag rename"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onDone(title);
      }}
    />
  );
}
