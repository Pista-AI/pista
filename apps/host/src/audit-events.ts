// Audit events beyond the session pair: prompts, tool decisions and results, project trust, model usage.
// Without the policy's opt-ins no prompt text, tool arguments, paths, full URLs or command lines are recorded.
// Nothing here may throw or change a gate's return value: every emit is wrapped in `safe`.
import { basename } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { ChatMessage } from "@pista/protocol";
import type { AuditAttrs, AuditSink } from "./audit.ts";
import { SECRET_WORDS } from "./secrets.ts";
import { INTERNAL_TOOLS, isShellTool, parseMcpName } from "./policy-tools.ts";

const SECRET_KEY = new RegExp(SECRET_WORDS, "i");
const SECRET_TEXT: [RegExp, string][] = [
  [/Bearer\s+\S+/gi, "Bearer [redacted]"],
  [new RegExp(`\\b(${SECRET_WORDS})(\\s*[:=]\\s*)\\S+`, "gi"), "$1$2[redacted]"],
];
const ARGS_LIMIT = 4096;

const safe = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // Audit must never affect the agent.
  }
};

/** JSON.stringify that cannot throw (circular, BigInt) and always returns a string. */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "";
  } catch {
    return "[unserializable]";
  }
}

/** Cuts to `limit` UTF-16 units without leaving half a surrogate pair. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const end = /[\uD800-\uDBFF]/.test(text[limit - 1] ?? "") ? limit - 1 : limit;
  return text.slice(0, end);
}

/** A sink that adds fixed attributes (session.id, project.id) to every record. `get` is read per record. */
export function scopeAudit(sink: AuditSink, get: () => AuditAttrs): AuditSink {
  return {
    ...sink,
    emit: (name, attrs, opts) => safe(() => sink.emit(name, { ...get(), ...attrs }, opts)),
    flush: () => sink.flush(),
    dispose: () => sink.dispose(),
  };
}

/** Copy of `value` with secret-looking keys, secret values and `Bearer x` / `token=x` style text replaced by [redacted]. */
export function scrub(value: unknown, secrets: string[], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    const bare = secrets.reduce((s, secret) => s.split(secret).join("[redacted]"), value);
    return SECRET_TEXT.reduce((s, [re, to]) => s.replace(re, to), bare);
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((v) => scrub(v, secrets, seen));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : scrub(v, secrets, seen)]));
  }
  return value;
}

export type ToolKind = "builtin" | "shell" | "mcp" | "browser" | "internal";

/** The executable of a command line, skipping leading NAME=value assignments; basename only. */
function commandName(command: string): string | undefined {
  const word = command.trim().split(/\s+/).find((t) => !/^\w+=/.test(t));
  const name = word ? basename(word.replace(/\\/g, "/")) : "";
  return name && !name.includes("=") ? name : undefined;
}

/** Kind plus the extra attributes that are safe without includeToolArgs (server/tool names, domain host, executable name). */
export function classifyTool(toolName: string, input: unknown): { kind: ToolKind; attrs: AuditAttrs } {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mcp = parseMcpName(toolName);
  if (mcp) return { kind: "mcp", attrs: { "mcp.server": mcp.server, "mcp.tool": mcp.tool } };
  if (toolName.startsWith("browser_")) {
    let domain: string | undefined;
    if ((toolName === "browser_navigate" || toolName === "browser_download") && typeof args.url === "string") {
      try {
        domain = new URL(args.url).hostname;
      } catch {}
    }
    return { kind: "browser", attrs: { "browser.action": toolName.slice("browser_".length), "url.domain": domain } };
  }
  if (isShellTool(toolName)) return { kind: "shell", attrs: { "shell.command_name": typeof args.command === "string" ? commandName(args.command) : undefined } };
  return { kind: INTERNAL_TOOLS.includes(toolName) ? "internal" : "builtin", attrs: {} };
}

export type DecisionSource = "policy" | "approval" | "loop_guard" | "extension";

export function emitDecision(audit: AuditSink, toolName: string, input: unknown, decision: "allow" | "deny", extra: { source?: DecisionSource; rule?: string } = {}): void {
  safe(() => {
    const { kind, attrs } = classifyTool(toolName, input);
    const body = audit.includeToolArgs ? { body: truncate(String(safeStringify(scrub(input, audit.secrets))), ARGS_LIMIT) } : undefined;
    audit.emit("pista.tool.decision", { "tool.name": toolName, "tool.kind": kind, ...attrs, decision, "decision.rule": extra.rule, "decision.source": extra.source }, body);
  });
}

export function emitPrompt(audit: AuditSink, text: string, queued = false): void {
  safe(() => audit.emit("pista.prompt", { "prompt.length": text.length, ...(queued ? { "prompt.queued": true } : {}) }, audit.includePrompts ? { body: String(scrub(text, audit.secrets)) } : undefined));
}

/** One usage record per assistant message of the run (from `startIndex`). `input_tokens` excludes cache tokens. */
export function emitUsage(audit: AuditSink, messages: ChatMessage[], startIndex: number): void {
  safe(() => {
    for (const m of messages.slice(startIndex)) {
      if (m.role !== "assistant" || !m.usage) continue;
      audit.emit("pista.model.usage", {
        "gen_ai.request.model": m.model,
        "gen_ai.provider.name": m.provider,
        "gen_ai.usage.input_tokens": m.usage.input,
        "gen_ai.usage.output_tokens": m.usage.output,
        "gen_ai.usage.cache_read.input_tokens": m.usage.cacheRead,
        "gen_ai.usage.cache_creation.input_tokens": m.usage.cacheWrite,
        cost: m.usage.cost?.total,
      });
    }
  });
}

/**
 * Per-thread tool audit. Pi stops the tool_call chain at the first block and runs no tool_result handler for a
 * blocked call, so: gates report their own denials (`observeBlocks`, the policy gate's `onDeny`), the last
 * extension reports allows, and the session's tool_execution_start/end events (which every call yields) give
 * results and catch a block by an earlier user or project extension (decision.source="extension").
 */
export class ToolAudit {
  private decided = new Set<string>();
  private started = new Map<string, { at: number; name: string; input: unknown }>();
  constructor(readonly audit: AuditSink) {}

  decision(toolCallId: string, toolName: string, input: unknown, decision: "allow" | "deny", extra: { source?: DecisionSource; rule?: string } = {}): void {
    this.decided.add(toolCallId);
    emitDecision(this.audit, toolName, input, decision, extra);
  }

  start(event: { toolCallId: string; toolName: string; args?: unknown }): void {
    this.started.set(event.toolCallId, { at: Date.now(), name: event.toolName, input: event.args });
  }

  end(event: { toolCallId: string; isError?: boolean }): void {
    const call = this.started.get(event.toolCallId);
    this.started.delete(event.toolCallId);
    if (!call) return;
    if (!this.decided.delete(event.toolCallId)) emitDecision(this.audit, call.name, call.input, "deny", { source: "extension" });
    safe(() => {
      const { kind, attrs } = classifyTool(call.name, call.input);
      this.audit.emit("pista.tool.result", { "tool.name": call.name, "tool.kind": kind, ...attrs, success: !event.isError, "duration.ms": Date.now() - call.at });
    });
  }

  clear(): void {
    this.decided.clear();
    this.started.clear();
  }
}

/** Last in line, so it only sees calls every gate allowed. */
export function auditToolsExtension(tools: ToolAudit): InlineExtension {
  return {
    name: "audit-tools",
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", (event) => {
        tools.decision(event.toolCallId, event.toolName, event.input, "allow");
        return undefined;
      });
    },
  };
}

/** Wraps an extension so a block it returns, or an error it throws (rethrown unchanged), is reported as a deny from `source`. */
export function observeBlocks(extension: InlineExtension, source: DecisionSource, tools: ToolAudit): InlineExtension {
  const ext = extension as { name: string; factory: (pi: ExtensionAPI) => void | Promise<void> };
  return {
    ...ext,
    factory: (pi: ExtensionAPI) =>
      ext.factory(
        new Proxy(pi, {
          get(target, prop) {
            if (prop === "on") {
              return (name: string, handler: (...args: any[]) => any) =>
                (target.on as any)(name, name !== "tool_call" ? handler : async (event: any, ctx: any) => {
                  let result;
                  try {
                    result = await handler(event, ctx);
                  } catch (error) {
                    tools.decision(event.toolCallId, event.toolName, event.input, "deny", { source, rule: "gate.error" });
                    throw error;
                  }
                  if (result?.block) tools.decision(event.toolCallId, event.toolName, event.input, "deny", { source });
                  return result;
                });
            }
            const value = Reflect.get(target, prop);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      ),
  } as InlineExtension;
}
