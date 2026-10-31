import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Globe, ImagePlus, Lock, Plus, Shield, ShieldCheck, Square, X } from "lucide-react";
import type { ApprovalMode, ThinkingLevel, ThinkingMode } from "@pista/protocol";
import { actions, toast, useApp } from "../lib/store.ts";
import { hostLabel, useBrowser } from "../browser/controller.ts";
import { computeChanges } from "../lib/changes.ts";
import { pickerName } from "../lib/llama.ts";
import { useConfigField } from "../lib/useConfigField.ts";
import { ManagedBadge } from "./ManagedBadge.tsx";
import { MenuItem, Popover } from "./Popover.tsx";
import { GoalChip } from "./GoalControls.tsx";

const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

const APPROVAL: Record<ApprovalMode, { label: string; desc: string; icon: typeof Shield; color: string }> = {
  "read-only": { label: "Read only", desc: "Blocks edits, commands and platform writes", icon: Lock, color: "var(--text-2)" },
  "ask-writes": { label: "Ask before writes", desc: "Asks before edits, commands and platform writes", icon: Shield, color: "var(--amber)" },
  "full-access": { label: "Full access", desc: "Never asks. Use in trusted environments only", icon: ShieldCheck, color: "var(--red)" },
};

interface Attachment {
  data: string;
  mimeType: string;
}

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const [head, data] = String(reader.result).split(",");
      resolve({ data, mimeType: head.match(/data:(.*);base64/)?.[1] ?? file.type });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function Composer({ autoFocusKey, seed, placeholder, simple, tall }: { autoFocusKey: string; seed?: { text: string; n: number }; placeholder?: string; /** Hides the add, permissions and model controls (focused mode). */ simple?: boolean; /** Roomy text box for pasting (focused mode, empty thread). */ tall?: boolean }) {
  const { activeThreadId, views, models, config, pageContext } = useApp();
  const approvalField = useConfigField("approvalMode");
  const view = activeThreadId ? views[activeThreadId] : undefined;
  const focusedTab = useBrowser((s) => (s.focusedId ? s.tabs[s.focusedId] : undefined));
  const [text, setText] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => ta.current?.focus(), [autoFocusKey]);
  useEffect(() => {
    if (seed) {
      setText(seed.text);
      ta.current?.focus();
    }
  }, [seed]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text, tall]);

  const currentModel = view?.model ?? config?.defaultModel;
  const modelInfo = models.find((m) => m.provider === currentModel?.provider && m.id === currentModel?.id);
  const draftMode = useApp((s) => s.draftThinkingMode);
  const mode: ThinkingMode = view?.thinkingMode ?? draftMode ?? config?.defaultThinkingMode ?? "auto";
  const levels: ThinkingLevel[] = view?.availableThinkingLevels?.length ? view.availableThinkingLevels : ["off", "low", "medium", "high"];
  const streaming = Boolean(view?.isStreaming);
  // Models with only off + one level (e.g. LM Studio) are a simple on/off switch.
  const onOff = levels.length === 2 && levels.includes("off");
  const levelLabel = (l: ThinkingMode) => (l === "auto" ? "Auto" : onOff ? (l === "off" ? "Off" : "On") : THINKING_LABEL[l]);
  const modeOptions: ThinkingMode[] = ["auto", ...levels];
  const approval = APPROVAL[config?.approvalMode ?? "ask-writes"];
  const changes = useMemo(() => computeChanges(view?.messages ?? []), [view?.messages]);
  const added = changes.reduce((n, c) => n + c.added, 0);
  const removed = changes.reduce((n, c) => n + c.removed, 0);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of models) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    return [...map.entries()];
  }, [models]);

  const submit = async (delivery?: "steer" | "followUp") => {
    const value = text.trim();
    if (!value && images.length === 0) return;
    const page = pageContext ? `\n\n(Referenced page in the built-in browser: ${pageContext.title ? `${pageContext.title} — ` : ""}${pageContext.url})` : "";
    setText("");
    setImages([]);
    useApp.setState({ pageContext: null });
    try {
      await actions.send(value + page, images, delivery);
    } catch (e) {
      setText(value);
      toast((e as Error).message, "error");
      if (/model|sign in/i.test((e as Error).message)) useApp.setState({ settingsOpen: "providers" });
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    const added = await Promise.all(files.map(readImage));
    setImages((prev) => [...prev, ...added]);
  };

  const queued = (view?.queue.steering.length ?? 0) + (view?.queue.followUp.length ?? 0);

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        {view?.goal && activeThreadId && <GoalChip threadId={activeThreadId} goal={view.goal} />}
        {(changes.length > 0 || queued > 0) && (
          <div className="above-composer">
            {changes.length > 0 && (
              <button className="changes-pill" onClick={() => actions.openPanelTab("changes")}>
                {changes.length} file{changes.length > 1 ? "s" : ""} changed <span className="add">+{added}</span>{" "}
                <span className="del">-{removed}</span>
              </button>
            )}
            {queued > 0 && <span className="queue-hint">{queued} queued</span>}
          </div>
        )}
        <div className={`composer ${tall ? "tall" : ""}`}>
          {(images.length > 0 || pageContext) && (
            <div className="attachments">
              {pageContext && (
                <span className="context-chip" title={pageContext.url}>
                  <Globe size={13} />
                  <span className="ellipsis">{pageContext.title || hostLabel(pageContext.url)}</span>
                  <button onClick={() => useApp.setState({ pageContext: null })}>
                    <X size={12} />
                  </button>
                </span>
              )}
              {images.map((img, i) => (
                <div className="attachment" key={i}>
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button onClick={() => setImages(images.filter((_, j) => j !== i))}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={placeholder ?? (streaming ? "Steer the agent · ⌥↩ to queue a follow-up" : "Ask Pista to do anything")}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit(e.altKey ? "followUp" : "steer");
              }
              if (e.key === "Escape" && streaming) void actions.abort();
            }}
          />
          <div className="composer-row">
            {!simple && (
            <Popover
              trigger={({ toggle }) => (
                <button className="icon-btn round" title="Add" onClick={toggle}>
                  <Plus size={19} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem icon={<ImagePlus size={15} />} onClick={() => (close(), file.current?.click())}>
                    Attach image
                  </MenuItem>
                  <MenuItem
                    icon={<Globe size={15} />}
                    description={focusedTab ? hostLabel(focusedTab.url) : "No browser tab open"}
                    onClick={() => {
                      close();
                      if (focusedTab) useApp.setState({ pageContext: { url: focusedTab.url, title: focusedTab.title } });
                    }}
                  >
                    Reference current page
                  </MenuItem>
                </>
              )}
            </Popover>
            )}
            <input
              ref={file}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={async (e) => {
                const added = await Promise.all([...(e.target.files ?? [])].map(readImage));
                setImages((prev) => [...prev, ...added]);
                e.target.value = "";
              }}
            />

            {!simple && (
            <Popover
              trigger={({ toggle }) => (
                <>
                  <button
                    className="icon-btn round"
                    title={`Permissions: ${approval.label}${approvalField.locked ? " (managed by your organisation)" : ""}`}
                    disabled={approvalField.locked}
                    onClick={toggle}
                    style={{ color: approval.color }}
                  >
                    <approval.icon size={17} />
                  </button>
                  <ManagedBadge locked={approvalField.locked} />
                </>
              )}
            >
              {(close) =>
                (Object.keys(APPROVAL) as ApprovalMode[]).map((mode) => {
                  const a = APPROVAL[mode];
                  return (
                    <MenuItem
                      key={mode}
                      icon={<a.icon size={15} color={a.color} />}
                      description={a.desc}
                      checked={mode === config?.approvalMode}
                      onClick={() => {
                        close();
                        void approvalField.set(mode);
                      }}
                    >
                      {a.label}
                    </MenuItem>
                  );
                })
              }
            </Popover>
            )}

            <div className="spacer" />
            {view?.contextUsage?.percent != null && view.contextUsage.percent > 40 && (
              <span className="context-ring">{Math.round(view.contextUsage.percent)}%</span>
            )}

            {!simple && (
            <Popover
              placement="top-end"
              trigger={({ toggle }) => (
                <button
                  className="chip model-chip"
                  onClick={() => {
                    toggle();
                    void actions.refreshModels();
                  }}
                >
                  <span className="lbl strong meta">{modelInfo ? pickerName(modelInfo.provider, modelInfo.name) : (currentModel?.id ?? "Choose model")}</span>
                  {(modelInfo?.reasoning ?? true) && mode !== "auto" && <span className="lbl">{mode === "off" ? "No thinking" : onOff ? "Thinking" : THINKING_LABEL[mode]}</span>}
                  <ChevronDown size={14} />
                </button>
              )}
            >
              {(close) => (
                <>
                  {grouped.length === 0 ? (
                    <MenuItem
                      description="No provider is signed in yet"
                      onClick={() => {
                        close();
                        useApp.setState({ settingsOpen: "providers" });
                      }}
                    >
                      Sign in to a model provider…
                    </MenuItem>
                  ) : (
                    grouped.map(([provider, list]) => (
                      <div key={provider}>
                        <div className="menu-label">{provider === "llama.cpp" ? "Built-in (llama.cpp)" : provider}</div>
                        {list.map((m) => (
                          <MenuItem
                            key={m.id}
                            checked={m.provider === currentModel?.provider && m.id === currentModel?.id}
                            onClick={() => {
                              close();
                              void actions.setModel(m.provider, m.id).catch((e: Error) => toast(e.message, "error"));
                            }}
                          >
                            {pickerName(m.provider, m.name)}
                          </MenuItem>
                        ))}
                      </div>
                    ))
                  )}
                  {(modelInfo?.reasoning ?? true) && (
                    <>
                      <div className="menu-sep" />
                      <div className="menu-label">{onOff ? "Thinking" : "Reasoning"}</div>
                      <div className="seg-menu">
                        {modeOptions.map((l) => (
                          <button key={l} className={l === mode ? "on" : ""} onClick={() => void actions.setThinking(l)}>
                            {levelLabel(l)}
                          </button>
                        ))}
                      </div>
                      <div className="menu-hint">Auto thinks only when a message needs it.</div>
                    </>
                  )}
                </>
              )}
            </Popover>
            )}

            {streaming && !text.trim() ? (
              <button className="send-btn" title="Stop (Esc)" onClick={() => actions.abort()}>
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button className="send-btn" title="Send (↩)" disabled={!text.trim() && images.length === 0} onClick={() => submit("steer")}>
                <ArrowUp size={18} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
