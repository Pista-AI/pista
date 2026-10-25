import { useEffect, useRef, useState } from "react";
import { Brain, CircleCheck, Cpu, HardDrive, KeyRound, Plug, RotateCw, Settings as Gear } from "lucide-react";
import { LOGIN_CANCELLED } from "@pista/protocol";
import type { AgentRoleName, LocalServerStatus, McpExposure, McpServerConfig, McpServerStatus, MemorySnapshot } from "@pista/protocol";
import { Markdown } from "./Transcript.tsx";
import { LlamaRuntimeCard } from "./LlamaRuntimeCard.tsx";
import { actions, toast, useApp, type AuthNotice } from "../lib/store.ts";
import { openExternal } from "../lib/links.ts";
import { useConfigField } from "../lib/useConfigField.ts";
import { ManagedBadge } from "./ManagedBadge.tsx";
import { host } from "../lib/host.ts";

type Tab = Exclude<ReturnType<typeof useApp.getState>["settingsOpen"], false>;

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  if (!open) return null;
  const close = () => useApp.setState({ settingsOpen: false });
  const nav = (id: Tab, label: string, Icon: typeof Gear) => (
    <button className={`nav-item ${open === id ? "active" : ""}`} onClick={() => useApp.setState({ settingsOpen: id })}>
      <Icon size={15} /> {label}
    </button>
  );
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-nav">
          <h2>Settings</h2>
          {nav("general", "General", Gear)}
          {nav("providers", "Model providers", Cpu)}
          {nav("mcp", "MCP servers", Plug)}
          {nav("memory", "Memory", Brain)}
        </div>
        <div className="modal-body">
          {open === "general" && <General />}
          {open === "providers" && <Providers />}
          {open === "mcp" && <Mcp />}
          {open === "memory" && <Memory />}
        </div>
      </div>
    </div>
  );
}

function useDraft<T>(value: T | undefined) {
  const [draft, setDraft] = useState<T | undefined>(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft] as const;
}

// Mirrors ROLES in apps/host/src/roles.ts (descriptions only; the host owns tools and defaults).
const ROLE_DESCRIPTIONS: Record<AgentRoleName, string> = {
  explorer: "Read-only research: reads, greps and lists files, then reports what it found.",
  implementer: "Makes changes: full tool set, same approvals as the parent.",
  reviewer: "Read-only review of files and changes, reports findings.",
};

/** Per-role model for sub-agents; "Same as thread" removes the override so the child uses its parent's model. */
function AgentRoles() {
  const config = useApp((s) => s.config);
  const models = useApp((s) => s.models);
  const field = useConfigField("agentRoles");
  if (!config) return null;
  const roles = field.value ?? {};
  const setRole = (role: AgentRoleName, value: string) => {
    const next = { ...roles };
    if (value) {
      const [provider, ...rest] = value.split("/");
      next[role] = { model: { provider, id: rest.join("/") } };
    } else delete next[role];
    return field.set(next);
  };
  const providers = [...new Set(models.map((m) => m.provider))];
  return (
    <div className="field">
      <label>
        Sub-agent roles <ManagedBadge locked={field.locked} />
      </label>
      {(Object.keys(ROLE_DESCRIPTIONS) as AgentRoleName[]).map((role) => {
        const model = roles[role]?.model;
        const value = model ? `${model.provider}/${model.id}` : "";
        const known = !model || models.some((m) => m.provider === model.provider && m.id === model.id);
        return (
          <div key={role} className="field">
            <label htmlFor={`role-${role}`} style={{ textTransform: "capitalize" }}>
              {role}
            </label>
            <span className="help">{ROLE_DESCRIPTIONS[role]}</span>
            <select id={`role-${role}`} value={value} disabled={field.locked} onChange={(e) => void setRole(role, e.target.value)}>
              <option value="">Same as thread</option>
              {!known && <option value={value}>{value} (unavailable)</option>}
              {providers.map((provider) => (
                <optgroup key={provider} label={provider}>
                  {models
                    .filter((m) => m.provider === provider)
                    .map((m) => (
                      <option key={m.id} value={`${m.provider}/${m.id}`}>
                        {m.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
        );
      })}
      <span className="help">The model each sub-agent role runs on. "Same as thread" uses the model of the thread that started it.</span>
    </div>
  );
}

function General() {
  const config = useApp((s) => s.config);
  const info = useApp((s) => s.info);
  const linkTarget = useConfigField("linkTarget");
  const webSearch = useConfigField("webSearchEnabled");
  const approval = useConfigField("approvalMode");
  const maxTokens = useConfigField("maxOutputTokens");
  const custom = useConfigField("instructions");
  const [instructions, setInstructions] = useDraft(custom.value);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "system");
  const [maxOut, setMaxOut] = useDraft(maxTokens.value?.toString() ?? "");
  if (!config) return null;

  const saveMaxOut = () => {
    const text = (maxOut ?? "").trim();
    const n = Number(text);
    // Only an empty field clears the cap; invalid input snaps back to the saved value.
    const next = text === "" ? null : Number.isSafeInteger(n) && n > 0 ? n : undefined;
    if (next === undefined || next === (maxTokens.value ?? null)) return setMaxOut(maxTokens.value?.toString() ?? "");
    void maxTokens.set(next);
  };

  const applyTheme = (t: string) => {
    setTheme(t);
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("pista.theme", t);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <>
      <h3>General</h3>
      <p className="sub">
        Pista {info?.version} · Pi {info?.piVersion} · {info?.platform}
      </p>
      <div className="field">
        <label>Theme</label>
        <div className="seg">
          {["system", "light", "dark"].map((t) => (
            <button key={t} className={theme === t ? "on" : ""} onClick={() => applyTheme(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <HomePage />
      <div className="field">
        <label>
          Open links in <ManagedBadge locked={linkTarget.locked} />
        </label>
        <div className="seg">
          {(
            [
              ["builtin", "In app"],
              ["home", "Home site in app"],
              ["external", "External browser"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={(linkTarget.value ?? "builtin") === value ? "on" : ""} disabled={linkTarget.locked} onClick={() => linkTarget.set(value)}>
              {label}
            </button>
          ))}
        </div>
        <span className="help">"Home site in app" opens links to your home page's site in the built-in browser and everything else in your default browser. Hold ⌘ (Ctrl) while clicking to open a link the other way. Sign-in pages always open externally.</span>
      </div>
      <div className="field">
        <label>
          Web search <ManagedBadge locked={webSearch.locked} />
        </label>
        <div className="seg">
          {([true, false] as const).map((on) => (
            <button key={String(on)} className={webSearch.value === on ? "on" : ""} disabled={webSearch.locked} onClick={() => webSearch.set(on)}>
              {on ? "On" : "Off"}
            </button>
          ))}
        </div>
        <span className="help">
          Lets the agent search the web and read pages to check facts instead of guessing. Searches are sent to Exa by default (no API key); other
          providers can be set in <code>~/.pi/agent/web-search.json</code>.
        </span>
      </div>
      <div className="field">
        <label>
          Permissions <ManagedBadge locked={approval.locked} />
        </label>
        <div className="seg">
          {(
            [
              ["read-only", "Read only"],
              ["ask-writes", "Ask before writes"],
              ["full-access", "Full access"],
            ] as const
          ).map(([mode, label]) => (
            <button key={mode} className={approval.value === mode ? "on" : ""} disabled={approval.locked} onClick={() => approval.set(mode)}>
              {label}
            </button>
          ))}
        </div>
        <span className="help">Applies to file edits, shell commands, browser interaction and MCP tools that change data.</span>
      </div>
      <div className="field">
        <label>
          Max output tokens per response <ManagedBadge locked={maxTokens.locked} />
        </label>
        <input
          type="number"
          min={1}
          step={1}
          value={maxOut ?? ""}
          placeholder="Model default"
          disabled={maxTokens.locked}
          onChange={(e) => setMaxOut(e.target.value)}
          onBlur={saveMaxOut}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className="help">Caps how long one model response can be, including reasoning. Empty uses each model's default.</span>
      </div>
      <AgentRoles />
      <div className="field">
        <label>
          Custom instructions <ManagedBadge locked={custom.locked} />
        </label>
        <textarea
          value={instructions ?? ""}
          placeholder="E.g. Always work in the dev environment unless I say otherwise."
          disabled={custom.locked}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => instructions !== custom.value && custom.set(instructions ?? "")}
        />
        <span className="help">Appended to the system prompt of every thread. AGENTS.md files in the project folder are also loaded.</span>
      </div>
    </>
  );
}

function HomePage() {
  const config = useApp((s) => s.config);
  const home = useConfigField("homeUrl");
  const [url, setUrl] = useDraft(home.value);
  if (!config) return null;
  return (
    <div className="field">
      <label>
        Browser home page <ManagedBadge locked={home.locked} />
      </label>
      <input
        type="url"
        value={url ?? ""}
        spellCheck={false}
        disabled={home.locked}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={() => url && url !== home.value && home.set(url)}
      />
      <span className="help">Opened in new browser tabs; relative links resolve against it.</span>
    </div>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** What a sign-in in progress asks of the user: the code, the page to enter it on, and a way out. */
function SignInPanel({ notice }: { notice: AuthNotice }) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const expiresAt = notice.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(notice.code ?? "");
      ok = true;
    } catch {
      const el = codeRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
      }
    }
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (notice.done) {
    return notice.error ? (
      <div className="signin-panel signin-error">
        <div className="signin-error-row">
          <span>{notice.message} {notice.error}</span>
          <button className="pill-btn" aria-label="Dismiss" title="Dismiss" onClick={() => actions.dismissAuthNotice(notice.provider)}>
            ×
          </button>
        </div>
      </div>
    ) : null;
  }
  const remaining = expiresAt ? expiresAt - now : null;
  const expired = remaining !== null && remaining <= 0;
  return (
    <div className="signin-panel">
      <div>{notice.message}</div>
      {notice.code && (
        <div className="signin-code-row">
          <code className="signin-code" ref={codeRef}>{notice.code}</code>
          <button className="pill-btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
      )}
      {notice.url && (
        <a className="signin-link" href={notice.url} target="_blank" rel="noreferrer">
          {notice.url}
        </a>
      )}
      <div className="signin-actions">
        {notice.url && (
          <button className="pill-btn" onClick={() => openExternal(notice.url!)}>
            Open sign-in page
          </button>
        )}
        <button className="pill-btn" onClick={() => void actions.cancelLogin(notice.provider)}>
          Cancel
        </button>
        {remaining !== null && <span className="signin-expiry">{expired ? "Code expired, cancel and start again" : `Expires in ${formatCountdown(remaining)}`}</span>}
      </div>
    </div>
  );
}

function Providers() {
  const providers = useApp((s) => s.providers);
  const notices = useApp((s) => s.authNotices);
  const noLogin = useApp((s) => !!s.policy.providers?.disableDirectLogin);
  const [query, setQuery] = useState("");
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  /** Provider whose sign-in was just started, until its first notice arrives. */
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    void actions.refreshProviders();
  }, []);

  const login = async (provider: string, type: "api_key" | "oauth", key?: string) => {
    if (type === "oauth") {
      actions.dismissAuthNotice(provider);
      setStarting(provider);
    }
    try {
      await host.call("auth.login", { provider, type, apiKey: key });
      setKeyFor(null);
      setApiKey("");
      await actions.refreshProviders();
      await actions.refreshModels();
    } catch (e) {
      if (!(e as Error).message.includes(LOGIN_CANCELLED)) toast((e as Error).message, "error");
    } finally {
      setStarting((current) => (current === provider ? null : current));
    }
  };

  const localIds = new Set(useApp.getState().config?.localServers.map((l) => l.id));
  const shown = providers.filter((p) => !localIds.has(p.id) && `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <h3>Model providers</h3>
      <p className="sub">The agent can use any provider Pi supports. Credentials are kept in <code>pi/auth.json</code> in the Pista data folder (copied from the Pi CLI on first start).</p>
      <LocalModels />
      <div className="settings-section-label">Cloud providers</div>
      <input className="search" placeholder="Search providers" value={query} onChange={(e) => setQuery(e.target.value)} />
      {shown.map((p) => (
        <div key={p.id}>
          <div className="provider-row">
            <KeyRound size={16} color="var(--text-3)" />
            <div className="pn">
              {p.name}
              <small>{p.id}</small>
            </div>
            {p.configured ? (
              <>
                <span className="status-ok">
                  <CircleCheck size={13} /> {p.oauth ? "Signed in" : "Configured"}
                  {p.oauth && p.subject && <span className="signin-subject"> as {p.subject}</span>}
                </span>
                <button className="pill-btn" onClick={() => host.call("auth.logout", { provider: p.id }).then(actions.refreshProviders).then(actions.refreshModels)}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                {noLogin && <ManagedBadge locked />}
                {p.authTypes.includes("oauth") && (
                  <button className="pill-btn" onClick={() => login(p.id, "oauth")}>
                    {p.sso ? `Sign in with ${p.name}` : "Sign in"}
                  </button>
                )}
                {p.authTypes.includes("api_key") && (
                  <button className="pill-btn" onClick={() => setKeyFor(keyFor === p.id ? null : p.id)}>
                    API key
                  </button>
                )}
              </>
            )}
          </div>
          {notices[p.id] ? (
            <SignInPanel notice={notices[p.id]!} />
          ) : (
            starting === p.id && (
              <div className="signin-panel">
                <div>Starting sign-in…</div>
                <div className="signin-actions">
                  <button className="pill-btn" onClick={() => void actions.cancelLogin(p.id)}>
                    Cancel
                  </button>
                </div>
              </div>
            )
          )}
          {keyFor === p.id && (
            <form
              style={{ display: "flex", gap: 8, padding: "8px 0 12px" }}
              onSubmit={(e) => {
                e.preventDefault();
                void login(p.id, "api_key", apiKey);
              }}
            >
              <input className="search" style={{ margin: 0 }} type="password" autoFocus placeholder={`${p.name} API key`} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <button className="pill-btn primary" disabled={!apiKey}>
                Save
              </button>
            </form>
          )}
        </div>
      ))}
    </>
  );
}

function Memory() {
  const config = useApp((s) => s.config);
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const load = () => host.call("memory.get", {}).then(setMemory, (e: Error) => toast(e.message, "error"));
  useEffect(() => {
    void load();
  }, [config?.memoryEnabled]);
  if (!config) return null;

  const section = (title: string, content: string, empty: string) => (
    <div className="field">
      <label>{title}</label>
      {content.trim() ? (
        <div className="memory-doc msg-assistant">
          <Markdown text={content} />
        </div>
      ) : (
        <span className="help">{empty}</span>
      )}
    </div>
  );

  return (
    <>
      <h3>Memory</h3>
      <p className="sub">
        The agent remembers facts, preferences and decisions across threads by writing markdown files. Say "remember that…" or "forget…" in any
        thread, or edit the files directly.
      </p>
      <div className="field">
        <label>Cross-thread memory</label>
        <div className="seg">
          {([true, false] as const).map((on) => (
            <button key={String(on)} className={config.memoryEnabled === on ? "on" : ""} onClick={() => actions.patchConfig({ memoryEnabled: on })}>
              {on ? "On" : "Off"}
            </button>
          ))}
        </div>
        <span className="help">
          Stored in <code>{memory?.dir ?? "~/.pista/pi/memory"}</code>, copied once from <code>~/.pi/agent/memory</code> and not shared with the pi CLI unless <code>PI_MEMORY_DIR</code> points there. Changes apply to idle threads right away.
        </span>
      </div>
      {memory && (
        <>
          <div className="settings-section-label">
            What the agent knows
            <button className="icon-btn sm" title="Reload" onClick={() => void load()}>
              <RotateCw size={13} />
            </button>
          </div>
          {section("Long-term memory", memory.longTerm, "Nothing saved yet.")}
          {section("Scratchpad", memory.scratchpad, "Empty.")}
          {memory.daily.map((d) => section(`Daily log · ${d.date}`, d.content, ""))}
        </>
      )}
    </>
  );
}

function LocalModels() {
  const [servers, setServers] = useState<LocalServerStatus[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setServers(await host.call("local.detect", {}));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const toggle = async (s: LocalServerStatus) => {
    try {
      if (s.added) await host.call("local.remove", { id: s.id });
      else await host.call("local.add", { kind: s.kind, name: s.name, baseUrl: s.baseUrl });
      await Promise.all([refresh(), actions.refreshModels()]);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <div className="settings-section-label">
        Local models
        <button className="icon-btn sm" title="Detect again" onClick={refresh} disabled={busy}>
          <RotateCw size={13} />
        </button>
      </div>
      {servers === null ? (
        <div className="help">Looking for LM Studio, Ollama and llama.cpp…</div>
      ) : (
        servers.map((s) => (
          <div key={s.baseUrl} className="local-server">
            <div className="provider-row">
              <HardDrive size={16} color="var(--text-3)" />
              <div className="pn">
                {s.name}
                <small>
                  {s.baseUrl} · {s.running ? `${s.models.length} model${s.models.length === 1 ? "" : "s"}` : "not running"}
                </small>
              </div>
              {s.added && (
                <span className="status-ok">
                  <CircleCheck size={13} /> Added
                </span>
              )}
              {(s.running || s.added) && (
                <button className={`pill-btn ${s.added ? "" : "primary"}`} onClick={() => toggle(s)}>
                  {s.added ? "Remove" : "Add"}
                </button>
              )}
            </div>
            {s.running && s.models.length > 0 && (
              <div className="local-models">
                {s.models.map((m) => (
                  <span key={m.id} className="local-model" title={m.id}>
                    {m.loaded && <i className="dot-loaded" title="Loaded" />}
                    {m.name ?? m.id}
                    {m.toolUse && <span className="badge">tools</span>}
                    {m.vision && <span className="badge">vision</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))
      )}
      <LlamaRuntimeCard />
      <div className="help" style={{ margin: "6px 0 4px" }}>
        Added servers appear in the model picker. LM Studio models load automatically with a 32k context on first use. Pick models with tool
        support for agent work.
      </div>
    </>
  );
}

function Mcp() {
  const threadId = useApp((s) => s.activeThreadId);
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);
  useEffect(() => {
    host.call("mcp.status", { threadId: threadId ?? undefined }).then(setServers, () => setServers([]));
  }, [threadId]);
  return (
    <>
      <h3>MCP servers</h3>
      <p className="sub">
        Servers live in <code>mcp.json</code> under the Pista data folder, in the standard <code>mcpServers</code> format that Claude Code and Cursor also use, and Pi
        connects them; trusted projects can add <code>.pi/mcp.json</code>. OAuth login from the UI is coming; servers that need OAuth show as needs-auth.
      </p>
      <McpServerList />
      <ProjectTrust />
      <div className="field">
        <label>Connected in {threadId ? "this thread" : "the first open thread"}</label>
        {servers === null ? (
          <span className="help">Loading…</span>
        ) : servers.length === 0 ? (
          <span className="help">No MCP tools loaded yet. Servers connect in the background when a thread opens.</span>
        ) : (
          servers.map((s) => (
            <div key={s.name} className="provider-row">
              <Plug size={15} color="var(--text-3)" />
              <div className="pn">
                {s.name}
                <small>
                  {s.toolCount} tools · {s.exposure}
                </small>
              </div>
              <span className="status-ok">
                <CircleCheck size={13} /> Connected
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function ProjectTrust() {
  const projects = useApp((s) => s.projects).filter((p) => !p.trustFixed);
  if (projects.length === 0) return null;
  return (
    <div className="field">
      <label>Trust project folder</label>
      {projects.map((p) => (
        <div key={p.id} className="provider-row">
          <div className="pn">
            {p.name}
            <small>{p.path}</small>
          </div>
          <div className="seg">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                className={(p.trusted === true) === on ? "on" : ""}
                onClick={() => actions.setProjectTrusted(p.id, on).catch((e: Error) => toast(e.message, "error"))}
              >
                {on ? "Trusted" : "Untrusted"}
              </button>
            ))}
          </div>
        </div>
      ))}
      <span className="help">Load this folder's .pi/ settings, MCP servers, extensions and skills. Idle threads reload now. Running threads keep the old setting until they finish.</span>
    </div>
  );
}

interface ServerDraft {
  transport: "http" | "stdio";
  name: string;
  url: string;
  /** HTTP: environment variable holding a bearer token. */
  authEnv: string;
  command: string;
  /** Stdio: arguments, separated by spaces. */
  args: string;
  /** Stdio: one environment variable name per line. */
  envNames: string;
  exposure: McpExposure;
  description: string;
}

const EMPTY_DRAFT: ServerDraft = { transport: "http", name: "", url: "", authEnv: "", command: "", args: "", envNames: "", exposure: "deferred", description: "" };
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The mcp.json entry for a form. Secrets are never written: only `${NAME}` references that Pi expands from the environment. */
function draftToServer(d: ServerDraft): McpServerConfig | string {
  const name = d.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  if (!name) return "A name is required.";
  const common = { name, exposure: d.exposure, ...(d.description.trim() ? { description: d.description.trim() } : {}) };
  if (d.transport === "http") {
    if (!d.url.trim()) return "A URL is required.";
    const authEnv = d.authEnv.trim();
    if (authEnv && !ENV_NAME.test(authEnv)) return "The auth header variable must be an environment variable name, not the token itself.";
    return { ...common, transport: "http", url: d.url.trim(), ...(authEnv ? { headers: { Authorization: `Bearer \${${authEnv}}` } } : {}) };
  }
  if (!d.command.trim()) return "A command is required.";
  const names = d.envNames.split("\n").map((l) => l.split("=")[0]!.trim()).filter(Boolean);
  if (names.some((n) => !ENV_NAME.test(n))) return "Environment variables are listed by name, one per line.";
  const args = d.args.trim() ? d.args.trim().split(/\s+/) : [];
  return {
    ...common,
    transport: "stdio",
    command: d.command.trim(),
    ...(args.length ? { args } : {}),
    ...(names.length ? { env: Object.fromEntries(names.map((n) => [n, `\${${n}}`])) } : {}),
  };
}

/** A stable empty list: a selector must not return a fresh array on every call. */
const NO_SERVERS: string[] = [];

/** MCP servers (remote streamable HTTP or local stdio) the agent can work with, e.g. a company platform. */
function McpServerList() {
  const config = useApp((s) => s.config);
  const managed = useApp((s) => s.policy.mcp?.managedServers) ?? NO_SERVERS;
  const canAdd = useApp((s) => s.policy.mcp?.allowUserServers !== false);
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  if (!config) return null;
  const servers = config.mcpServers ?? [];
  const save = async (next: McpServerConfig[]) => {
    try {
      await actions.patchConfig({ mcpServers: next });
      toast("Saved. Idle threads reconnect with the new servers.");
      return true;
    } catch (error) {
      toast((error as Error).message, "error");
      return false;
    }
  };
  const add = async () => {
    const server = draftToServer(draft!);
    if (typeof server === "string") return toast(server, "error");
    if (await save([...servers.filter((s) => s.name !== server.name), server])) setDraft(null);
  };
  const field = (key: keyof ServerDraft, label: string, placeholder: string, type = "text") => (
    <div className="field">
      <label>{label}</label>
      <input type={type} value={draft?.[key] ?? ""} placeholder={placeholder} spellCheck={false} onChange={(e) => setDraft({ ...draft!, [key]: e.target.value })} />
    </div>
  );
  return (
    <div className="field">
      <label>Added servers</label>
      {servers.length === 0 && !draft && <span className="help">None yet.</span>}
      {servers.map((s) => (
        <div key={s.name} className="provider-row">
          <Plug size={15} color="var(--text-3)" />
          <div className="pn">
            {s.name}
            <small>
              {s.transport === "http" ? s.url : [s.command, ...(s.args ?? [])].join(" ")} · {s.exposure ?? "codemode"}
            </small>
          </div>
          {managed.includes(s.name) ? (
            <ManagedBadge locked />
          ) : (
            <button className="pill-btn" onClick={() => save(servers.filter((x) => x.name !== s.name))}>
              Remove
            </button>
          )}
        </div>
      ))}
      {!canAdd ? (
        <span className="help">Adding servers is managed by your organisation.</span>
      ) : draft ? (
        <div className="mcp-add">
          <div className="seg">
            {(["http", "stdio"] as const).map((x) => (
              <button key={x} className={draft.transport === x ? "on" : ""} onClick={() => setDraft({ ...draft, transport: x })}>
                {x === "http" ? "HTTP" : "Stdio"}
              </button>
            ))}
          </div>
          {field("name", "Name", "e.g. acme")}
          {draft.transport === "http" ? (
            <>
              {field("url", "URL", "https://example.com/mcp", "url")}
              {field("authEnv", "Auth header env var (optional)", "e.g. ACME_TOKEN")}
              <span className="help">
                Sent as <code>Authorization: Bearer ${"{"}VAR{"}"}</code>. Set the variable where Pista starts; the token itself is never saved.
              </span>
            </>
          ) : (
            <>
              {field("command", "Command", "e.g. npx")}
              {field("args", "Arguments (separated by spaces)", "e.g. -y @modelcontextprotocol/server-filesystem .")}
              <div className="field">
                <label>Environment variables (names, one per line)</label>
                <textarea
                  rows={3}
                  value={draft.envNames}
                  placeholder={"API_KEY"}
                  spellCheck={false}
                  onChange={(e) => setDraft({ ...draft, envNames: e.target.value })}
                />
                <span className="help">
                  Each is passed to the server as <code>NAME=${"{"}NAME{"}"}</code>, taken from Pista's environment, so the value never enters the file.
                </span>
              </div>
            </>
          )}
          {field("description", "What it is for (shown to the agent)", "e.g. Our CRM: customers, deals and tasks")}
          <div className="field">
            <label>Tool exposure</label>
            <div className="seg">
              {(["direct", "deferred", "codemode"] as const).map((x) => (
                <button key={x} className={draft.exposure === x ? "on" : ""} onClick={() => setDraft({ ...draft, exposure: x })}>
                  {x}
                </button>
              ))}
            </div>
            <span className="help">
              direct: every tool declared to the model · deferred: loaded on demand through tool search (good for large servers) · codemode: called
              from scripts that can chain calls.
            </span>
          </div>
          <div className="btn-row">
            <button className="pill-btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="pill-btn primary" onClick={add}>
              Add server
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button className="pill-btn" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            Add MCP server
          </button>
        </div>
      )}
    </div>
  );
}
