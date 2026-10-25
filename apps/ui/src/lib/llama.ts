import type { LlamaDownload, LlamaRuntimeStatus } from "@pista/protocol";

/** "1.1 GB", "340 MB"; decimal units, matching what Hugging Face shows. */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${Math.round(n / 1e8) / 10} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** 16384 becomes "16k ctx", 32768 "32k ctx"; undefined stays empty. */
export function formatCtx(tokens?: number): string {
  if (!tokens) return "";
  return tokens >= 1000 ? `${Math.round(tokens / 1024)}k ctx` : `${tokens} ctx`;
}

/** 0..1, or undefined when the total is unknown. */
export function fraction(p?: { bytes: number; total?: number }): number | undefined {
  if (!p?.total) return undefined;
  return Math.min(1, Math.max(0, p.bytes / p.total));
}

export function percent(p?: { bytes: number; total?: number }): string {
  const f = fraction(p);
  return f === undefined ? "" : `${Math.round(f * 100)}%`;
}

export type RuntimeButton = "install" | "turn-on" | "turn-off" | "remove" | "retry";

/** What the runtime card offers per state. External and unsupported runtimes have nothing to install or remove. */
export function runtimeButtons(status: Pick<LlamaRuntimeStatus, "state" | "mode">): RuntimeButton[] {
  if (status.mode !== "managed") return [];
  switch (status.state) {
    case "not-installed":
      return ["install"];
    case "installed":
      return ["turn-on", "remove"];
    case "starting":
    case "running":
      return ["turn-off"];
    case "error":
      return ["retry"];
    default:
      return [];
  }
}

export function runtimeLabel(status: LlamaRuntimeStatus): string {
  if (status.mode === "off") return "Off";
  switch (status.state) {
    case "unsupported":
      return "Unsupported";
    case "not-installed":
      return "Not installed";
    case "installing": {
      const p = percent(status.progress);
      return p ? `Installing ${p}` : "Installing";
    }
    case "installed":
      return "Installed";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "error":
      return "Error";
  }
}

/** Where a download stands. Hosts that predate `phase` are read from `done`/`error`. */
export function downloadPhase(d: LlamaDownload): NonNullable<LlamaDownload["phase"]> {
  if (d.error) return "error";
  if (d.done) return "done";
  return d.phase === "starting" && d.bytes === 0 ? "starting" : "downloading";
}

/** Starting or downloading: the quant's button stays disabled and no second request may go out. */
export const downloadActive = (d?: LlamaDownload): boolean => !!d && (downloadPhase(d) === "starting" || downloadPhase(d) === "downloading");

export function downloadLabel(d: LlamaDownload): string {
  const phase = downloadPhase(d);
  if (phase === "error") return d.error ?? "Download failed";
  if (phase === "done") return "Done";
  if (phase === "starting") return "Starting download…";
  return d.total ? `${formatBytes(d.bytes)} of ${formatBytes(d.total)}` : d.bytes > 0 ? `Downloading… ${formatBytes(d.bytes)}` : "Downloading…";
}

/** Picker name for a built-in model: drops the org and the "(built-in)" suffix, since the group label says it. */
export function pickerName(provider: string, name: string): string {
  if (provider !== "llama.cpp") return name;
  return name.replace(/ \(built-in\)$/, "").replace(/^[^/\s]+\//, "");
}
