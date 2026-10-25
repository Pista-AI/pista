import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import type { LlamaModel, LlamaRuntimeStatus } from "@pista/protocol";
import { actions, toast } from "../lib/store.ts";
import { host } from "../lib/host.ts";
import { formatBytes, formatCtx, fraction, runtimeButtons, runtimeLabel } from "../lib/llama.ts";
import { LlamaModelSearch } from "./LlamaModelSearch.tsx";

/** Built-in llama.cpp runtime. Nothing is downloaded until the user installs it here. */
export function LlamaRuntimeCard() {
  const [status, setStatus] = useState<LlamaRuntimeStatus | null>(null);
  const [models, setModels] = useState<LlamaModel[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const loadModels = () => host.call("llama.models.list", {}).then(setModels, (e: Error) => toast(e.message, "error"));

  useEffect(() => {
    void host.call("llama.status", {}).then(setStatus, () => {});
    const off = host.on((event) => {
      if (event.type === "llama.status") setStatus(event.status);
      else if (event.type === "llama.models") {
        setModels(event.models);
        void actions.refreshModels().catch(() => {});
      }
      // Downloads live in the store (see onHostEvent), so they keep going while this card is unmounted.
    });
    return off;
  }, []);

  // The router lists models only while it runs.
  const running = status?.state === "running";
  useEffect(() => {
    if (running) void loadModels();
  }, [running]);

  if (!status) return null;

  const call = (method: "llama.enable" | "llama.disable" | "llama.remove") => host.call(method, {}).catch((e: Error) => toast(e.message, "error"));
  const remove = () => {
    if (confirm("Removes the runtime binary (about 30 MB). Downloaded models are kept.")) void call("llama.remove");
  };
  const act = async (id: string, method: "llama.models.load" | "llama.models.unload") => {
    setPending((p) => new Set(p).add(id));
    try {
      await host.call(method, { id });
      await Promise.all([loadModels(), actions.refreshModels()]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPending((p) => new Set([...p].filter((x) => x !== id)));
    }
  };

  const external = status.mode === "external";
  // A binary shipped inside the app cannot be removed from here; hide the action rather than offer a no-op.
  const bundled = status.source === "bundled";
  const buttons = runtimeButtons(status).filter((b) => !(bundled && b === "remove"));
  const detail = external
    ? `Using external llama-server at ${status.baseUrl ?? "the configured address"}`
    : status.mode === "off"
      ? (status.message ?? "Turned off by PISTA_LLAMA_RUNTIME")
      : status.state === "unsupported"
      ? (status.message ?? "Not available on this computer")
      : status.state === "error"
        ? (status.message ?? "Something went wrong")
        : status.state === "installing"
          ? "Downloading the runtime…"
          : status.state === "not-installed"
            ? "Runs GGUF models on this computer · about 30 MB download"
            : `${status.state === "running" ? "Running" : status.state === "starting" ? "Loading…" : "Installed · off"}${status.build ? ` · ${status.build}` : ""}${bundled ? " · Bundled with the app" : ""}`;
  const progress = status.state === "installing" ? fraction(status.progress) : undefined;
  const on = status.state === "running" || status.state === "starting";

  return (
    <div className="local-server">
      <div className="provider-row">
        <Cpu size={16} color="var(--text-3)" />
        <div className="pn">
          Built-in runtime (llama.cpp)
          <small className={status.state === "error" || status.state === "unsupported" ? "local-model-error" : undefined}>{detail}</small>
        </div>
        <span className={status.state === "running" ? "status-ok" : "badge"}>{runtimeLabel(status)}</span>
        {buttons.map((b) =>
          b === "remove" ? (
            <button key={b} className="pill-btn" onClick={remove}>
              Remove
            </button>
          ) : (
            <button key={b} className={`pill-btn ${b === "turn-off" ? "" : "primary"}`} onClick={() => call(b === "turn-off" ? "llama.disable" : "llama.enable")}>
              {b === "install" ? "Install" : b === "turn-on" ? "Turn on" : b === "turn-off" ? "Turn off" : "Retry"}
            </button>
          ),
        )}
      </div>
      {status.state === "installing" && (
        <div className="local-model-progress">
          <i style={{ width: `${Math.max(2, (progress ?? 0) * 100)}%` }} />
        </div>
      )}
      {on && (
        <div className="llama-models">
          {models.length === 0 && <div className="help">No models yet. Search Hugging Face to download one.</div>}
          {models.map((m) => {
            const busy = pending.has(m.id) || m.status === "loading" || m.status === "downloading";
            return (
              <div key={m.id} className="llama-model">
                <div className="llama-model-main">
                  {m.loaded && <i className="dot-loaded" title="Loaded" />}
                  <span className="llama-model-name" title={m.id}>
                    {m.name}
                  </span>
                  {m.reasoning && <span className="badge">reasoning</span>}
                  <small>{[m.loaded ? "" : m.status === "unloaded" ? "" : m.status, formatCtx(m.contextWindow), m.sizeBytes ? formatBytes(m.sizeBytes) : ""].filter(Boolean).join(" · ")}</small>
                  {m.message && m.status === "error" && <small className="local-model-error">{m.message}</small>}
                  {m.message && m.status !== "error" && (
                    <small className="tone-muted" style={{ flexBasis: "100%" }}>
                      {m.message}
                    </small>
                  )}
                </div>
                {on && (
                  <button className="pill-btn" disabled={busy} onClick={() => act(m.id, m.loaded ? "llama.models.unload" : "llama.models.load")}>
                    {m.loaded ? "Unload" : "Load"}
                  </button>
                )}
              </div>
            );
          })}
          <LlamaModelSearch />
        </div>
      )}
      {status.state === "not-installed" && status.mode === "managed" && (
        <div className="help local-model-help">Installs llama-server from the official llama.cpp release and checks its hash. Models download from Hugging Face only when you choose one.</div>
      )}
    </div>
  );
}
