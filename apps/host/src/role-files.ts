import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentRole, HostConfig, ThinkingLevel } from "@pista/protocol";
import { isTierRef } from "./model-tiers.ts";
import { applyOverrides, ROLES, type RoleMap } from "./roles.ts";

const LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** A comma-separated string or a YAML list of names. */
function list(value: unknown, key: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const items = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : undefined;
  if (!items || items.some((i) => typeof i !== "string" && typeof i !== "number")) throw new Error(`${key} must be a comma-separated string or a list of names`);
  return items.map((i) => String(i).trim()).filter(Boolean);
}

/**
 * Parses one role file (Pi / pi-subagents frontmatter, the subset Pista supports). Unknown keys are ignored, so
 * a full pi-subagents file still loads, and nothing that loosens permissions is read. Throws on a malformed file.
 */
export function parseAgentFile(text: string): AgentRole {
  const { frontmatter: f, body } = parseFrontmatter(text);
  if (typeof f.name !== "string" || !NAME.test(f.name)) throw new Error("name is required and must be a lowercase slug (a-z, 0-9, -)");
  if (typeof f.description !== "string" || !f.description.trim()) throw new Error("description is required");
  const role: AgentRole = { name: f.name, description: f.description.trim(), tools: list(f.tools, "tools") ?? [] };
  const exclude = list(f.excludeTools, "excludeTools");
  if (exclude?.length) role.excludeTools = exclude;
  if (isTierRef(f.model)) role.model = f.model;
  else if (f.model !== undefined) {
    const [provider, ...rest] = String(f.model).split("/");
    if (!provider || !rest.join("/")) throw new Error('model must look like "provider/model" or "tier:name"');
    role.model = { provider, id: rest.join("/") };
  }
  if (f.thinking !== undefined) {
    if (!LEVELS.includes(String(f.thinking))) throw new Error(`thinking must be one of ${LEVELS.join(", ")}`);
    role.thinking = f.thinking as ThinkingLevel;
  }
  const mode = f.systemPromptMode ?? "append";
  if (mode !== "append" && mode !== "replace") throw new Error('systemPromptMode must be "append" or "replace"');
  if (body.trim()) Object.assign(role, { prompt: body.trim(), promptMode: mode });
  return role;
}

/** Every valid `*.md` role in `dir`; a missing folder is empty and a bad file is skipped with a warning. */
export function loadAgentDir(dir: string, warn: (message: string) => void): AgentRole[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const roles: AgentRole[] = [];
  for (const file of files) {
    try {
      const role = parseAgentFile(readFileSync(join(dir, file), "utf8"));
      if (roles.some((r) => r.name === role.name)) warn(`${join(dir, file)}: name "${role.name}" is also used by an earlier file in this folder; the later file wins`);
      roles.push(role);
    } catch (error) {
      warn(`${join(dir, file)}: skipped, ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return roles;
}

/** A file named like a built-in keeps the built-in's tool set as a ceiling: tools intersect, exclusions add up. */
function narrowBuiltin(file: AgentRole): AgentRole {
  const base = Object.hasOwn(ROLES, file.name) ? ROLES[file.name as keyof typeof ROLES] : undefined;
  if (!base) return file;
  const tools = !base.tools.length ? file.tools : !file.tools.length ? base.tools : file.tools.filter((t) => base.tools.includes(t));
  // An allowlist that intersects to nothing would read as "unrestricted", so the role is switched off instead.
  const empty = file.tools.length > 0 && base.tools.length > 0 && tools.length === 0;
  return { ...file, tools, ...(empty ? { disabled: true } : {}) };
}

export interface AgentRolesOptions {
  /** `$PISTA_HOME/agents`. */
  userDir: string;
  /** Project-level files load only for a trusted project (see project-trust.ts). */
  isTrusted: (projectPath: string) => boolean;
  overrides: () => HostConfig["agentOverrides"];
  warn?: (message: string) => void;
}

/**
 * Roles per project: built-in, then user files, then the project's own files (by name), then `agentOverrides`.
 * Files are read once, on first use of a project, so a change needs a host restart.
 */
export class AgentRoles {
  private user: RoleMap | undefined;
  private projects = new Map<string, AgentRole[]>();
  private warn: (message: string) => void;

  constructor(private opts: AgentRolesOptions) {
    this.warn = opts.warn ?? ((m) => console.warn(`[pista-host] ${m}`));
  }

  forProject(projectPath: string): RoleMap {
    this.user ??= Object.fromEntries(loadAgentDir(this.opts.userDir, this.warn).map((r) => [r.name, narrowBuiltin(r)]));
    // Trust is checked on every call so revoking it drops project roles at once; only the parsed files are cached.
    let own: AgentRole[] = [];
    if (this.opts.isTrusted(projectPath)) {
      own = this.projects.get(projectPath) ?? loadAgentDir(join(projectPath, ".pista", "agents"), this.warn);
      this.projects.set(projectPath, own);
    }
    const merged: RoleMap = { ...ROLES, ...this.user, ...Object.fromEntries(own.map((r) => [r.name, narrowBuiltin(r)])) };
    return applyOverrides(merged, this.opts.overrides());
  }
}
