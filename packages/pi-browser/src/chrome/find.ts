import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BrowserKind = "chrome" | "edge" | "brave";
export type FoundBrowser = { kind: BrowserKind; path: string };

export type FindEnv = {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  home?: string;
};

const ORDER: BrowserKind[] = ["chrome", "edge", "brave"];

function candidates(kind: BrowserKind, platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string[] {
  if (platform === "darwin") {
    const app = { chrome: "Google Chrome", edge: "Microsoft Edge", brave: "Brave Browser" }[kind];
    const rel = `${app}.app/Contents/MacOS/${app}`;
    return [join("/Applications", rel), join(home, "Applications", rel)];
  }
  if (platform === "win32") {
    const rel = {
      chrome: "Google\\Chrome\\Application\\chrome.exe",
      edge: "Microsoft\\Edge\\Application\\msedge.exe",
      brave: "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    }[kind];
    return [env.PROGRAMFILES, env.PROGRAMW6432, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter((b): b is string => !!b).map((b) => `${b}\\${rel}`);
  }
  const names = { chrome: ["google-chrome", "google-chrome-stable"], edge: ["microsoft-edge"], brave: ["brave-browser"] }[kind];
  const dirs = (env.PATH ?? "").split(":").filter(Boolean);
  const opt = {
    chrome: ["/opt/google/chrome/chrome", "/snap/bin/chromium", "/var/lib/flatpak/exports/bin/com.google.Chrome"],
    edge: ["/opt/microsoft/msedge/msedge", "/var/lib/flatpak/exports/bin/com.microsoft.Edge"],
    brave: ["/opt/brave.com/brave/brave", "/snap/bin/brave", "/var/lib/flatpak/exports/bin/com.brave.Browser"],
  }[kind];
  return [...names.flatMap((n) => dirs.map((d) => join(d, n))), ...opt];
}

/** Locates an installed Chromium browser: Chrome, then Edge, then Brave, unless `prefer` is set. */
export function findBrowser(options: { prefer?: BrowserKind; overridePath?: string } = {}, deps: FindEnv = {}): FoundBrowser | null {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const home = deps.home ?? homedir();
  if (options.overridePath) {
    if (!exists(options.overridePath)) return null;
    const base = (options.overridePath.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.exe$/, "");
    const kind: BrowserKind = /^(msedge|microsoft-edge)/.test(base) || base.endsWith(".edge") ? "edge" : base.startsWith("brave") || base.endsWith(".browser") ? "brave" : "chrome";
    return { kind, path: options.overridePath };
  }
  const kinds = options.prefer ? [options.prefer, ...ORDER.filter((k) => k !== options.prefer)] : ORDER;
  for (const kind of kinds) {
    const path = candidates(kind, platform, env, home).find((c) => exists(c));
    if (path) return { kind, path };
  }
  return null;
}
