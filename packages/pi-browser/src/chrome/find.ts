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
    return [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter((b): b is string => !!b).map((b) => `${b}\\${rel}`);
  }
  const names = { chrome: ["google-chrome", "google-chrome-stable"], edge: ["microsoft-edge"], brave: ["brave-browser"] }[kind];
  const dirs = (env.PATH ?? "").split(":").filter(Boolean);
  const opt = { chrome: ["/opt/google/chrome/chrome"], edge: ["/opt/microsoft/msedge/msedge"], brave: ["/opt/brave.com/brave/brave"] }[kind];
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
    const p = options.overridePath.toLowerCase();
    const kind: BrowserKind = p.includes("edge") ? "edge" : p.includes("brave") ? "brave" : "chrome";
    return { kind, path: options.overridePath };
  }
  const kinds = options.prefer ? [options.prefer, ...ORDER.filter((k) => k !== options.prefer)] : ORDER;
  for (const kind of kinds) {
    const path = candidates(kind, platform, env, home).find((c) => exists(c));
    if (path) return { kind, path };
  }
  return null;
}
