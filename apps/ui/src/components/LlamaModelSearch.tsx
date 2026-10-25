import { useEffect, useState } from "react";
import { ChevronRight, Download, Search, X } from "lucide-react";
import type { LlamaHubModel } from "@pista/protocol";
import { actions, toast, useApp } from "../lib/store.ts";
import { host } from "../lib/host.ts";
import { compactNumber } from "../lib/format.ts";
import { downloadActive, downloadLabel, downloadPhase, formatBytes, fraction } from "../lib/llama.ts";

/** Search Hugging Face for GGUF models and download one. Progress comes from the store, so it survives closing Settings. */
export function LlamaModelSearch() {
  const downloads = useApp((s) => s.llamaDownloads);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LlamaHubModel[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** Repos whose file list was asked for and did not produce quants: still loading, nothing found, or failed. */
  const [inspect, setInspect] = useState<Record<string, "loading" | "empty" | "error">>({});

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      host.call("llama.models.search", { query: q }).then(
        (r) => live && setHits(r),
        (e: Error) => live && toast(e.message, "error"),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const expand = (hit: LlamaHubModel) => {
    if (open === hit.id) return setOpen(null);
    setOpen(hit.id);
    if (hit.files.length === 0) {
      setInspect((cur) => ({ ...cur, [hit.id]: "loading" }));
      host.call("llama.models.inspect", { id: hit.id }).then(
        (full) => {
          setHits((cur) => cur?.map((h) => (h.id === full.id ? { ...h, ...full } : h)) ?? null);
          setInspect((cur) => ({ ...cur, [hit.id]: full.files.length > 0 ? "loading" : "empty" }));
        },
        (e: Error) => {
          setInspect((cur) => ({ ...cur, [hit.id]: "error" }));
          toast(e.message, "error");
        },
      );
    }
  };

  const chips = Object.values(downloads);

  return (
    <div className="llama-add">
      <div className="llama-search">
        <Search size={14} color="var(--text-3)" />
        <input className="search" placeholder="Search Hugging Face for GGUF models" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {chips.map((d) => {
        const phase = downloadPhase(d);
        const f = phase === "done" ? 1 : fraction(d);
        return (
          <div key={d.spec} className="llama-dl">
            <div className="llama-dl-head">
              <span title={d.spec}>{d.spec}</span>
              <small className={phase === "error" ? "local-model-error" : undefined}>{downloadLabel(d)}</small>
              {phase === "error" && (
                <button className="icon-btn llama-dl-dismiss" title="Dismiss" aria-label={`Dismiss ${d.spec}`} onClick={() => actions.dismissLlamaDownload(d.spec)}>
                  <X size={12} />
                </button>
              )}
            </div>
            {phase !== "error" && (
              <div className={`local-model-progress${f === undefined ? " indeterminate" : ""}${phase === "done" ? " done" : ""}`} style={{ margin: "2px 0 0" }}>
                <i style={f === undefined ? undefined : { width: `${Math.max(2, f * 100)}%` }} />
              </div>
            )}
          </div>
        );
      })}
      {hits?.length === 0 && <div className="help">No GGUF models found.</div>}
      {hits?.map((hit) => (
        <div key={hit.id} className="llama-hit">
          <button className="llama-hit-head" onClick={() => expand(hit)}>
            <ChevronRight size={13} className={open === hit.id ? "open" : undefined} />
            <span className="llama-hit-id">{hit.id}</span>
            {hit.downloads !== undefined && <small>{compactNumber(hit.downloads)} downloads</small>}
          </button>
          {open === hit.id && (
            <div className="llama-quants">
              {hit.files.length === 0 ? (
                <small className={`help${inspect[hit.id] === "error" ? " local-model-error" : ""}`}>
                  {inspect[hit.id] === "empty" ? "No GGUF files found in this repository." : inspect[hit.id] === "error" ? "Could not load the file list." : "Loading files…"}
                </small>
              ) : (
                hit.files.map((f) => {
                  const spec = `${hit.id}:${f.quant}`;
                  return (
                    <button
                      key={f.quant}
                      className="pill-btn"
                      disabled={f.unresolved || downloadActive(downloads[spec])}
                      onClick={() => void actions.startLlamaDownload(spec)}
                      title={f.unresolved ? "Pista cannot derive a quant tag from this file name" : `Download ${spec}`}
                    >
                      <Download size={12} />
                      {f.quant} · {formatBytes(f.sizeBytes)}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
