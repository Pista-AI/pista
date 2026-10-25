import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Project } from "@pista/protocol";

export interface TrustDecision {
  trusted: boolean;
  /** One short phrase for the session-start log line. */
  reason: string;
}

function canonical(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/**
 * Whether Pi may load project-level resources (`.pi/settings.json`, `.pi/mcp.json`, `.pi/extensions`, skills,
 * prompts, packages) from `cwd`. Trusted only for the host-owned default workspace and for projects whose entry
 * in Pista's config says `trusted: true`; everything else is untrusted, with no prompt. A cloned repo can
 * therefore not register its own MCP servers or extensions. Pi's own `trust.json` and `defaultProjectTrust` are
 * deliberately not consulted.
 */
export function resolveProjectTrust(cwd: string, projects: readonly Project[], workspaceDir: string): TrustDecision {
  const target = canonical(cwd);
  if (target === canonical(workspaceDir)) return { trusted: true, reason: "default workspace" };
  const project = projects.find((p) => canonical(p.path) === target);
  if (project?.trusted === true) return { trusted: true, reason: "project marked trusted" };
  return { trusted: false, reason: project ? "project not marked trusted" : "not a registered project folder" };
}
