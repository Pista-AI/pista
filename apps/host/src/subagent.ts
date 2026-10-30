import { defineTool, type AgentSession, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentRole, AgentRoleName } from "@pista/protocol";
import { Type } from "typebox";
import type { RecordDecision } from "./decisions.ts";
import type { ThreadRef } from "./extensions.ts";
import { usageTotals } from "./models.ts";
import { briefProblem, capReport, composeBrief, hasReportSections, reportFollowUp } from "./brief.ts";
import { availableRoles, roleOf, ROLES, type RoleMap } from "./roles.ts";
import { clip } from "./text.ts";
import { feedbackPrompt, resolveVerifyConfig, runVerify, shellRunner, verifyKey, withProjectLock, type VerifyDeps } from "./verify.ts";
import type { ThreadManager } from "./threads.ts";

export const MAX_RUNNING_CHILDREN = 3;
export const DEFAULT_CHILD_TIMEOUT_MS = 30 * 60_000;

/** The slice of ThreadManager the tool needs; narrow so tests can stub it. */
export type ChildThreads = Pick<ThreadManager, "spawnChild" | "startPrompt" | "continueChild" | "abort">;

export interface AgentToolOptions {
  threads: ChildThreads;
  /** The thread that owns this tool; read at call time because the id is bound after the session is built. */
  ref: ThreadRef;
  /** Safety net for a child that never finishes (default 30 minutes). */
  timeoutMs?: number;
  /** Roles on offer; defaults to the built-ins. */
  roles?: RoleMap;
  /** Logs `agent_dispatch` and `agent_result` decisions. */
  record?: RecordDecision;
  /** Verify gate: when set, an implementer that changed files must pass the configured checks before its report is returned. */
  verify?: VerifyDeps;
  /** Ask each child for the structured report and send one follow-up when it is missing (default true). */
  reportFormat?: boolean;
}

export interface AgentToolParams {
  /** Required unless `continueId` is set; a continued child keeps its own role. */
  role?: AgentRoleName;
  /** What done looks like, 1-3 sentences; with `continueId` it is the follow-up message. */
  goal: string;
  /** Files, directories, symbols or commands worth starting from. */
  pointers?: string[];
  /** The command that must pass or the behaviour to verify; required for a new implementer. */
  acceptance?: string;
  /** Limits, e.g. files not to touch. */
  constraints?: string;
  continueId?: string;
  /** Why delegate this, in one sentence; logged with the dispatch. */
  reason?: string;
}

/** Shown with the tool call so the UI can link to the child before it finishes. */
export interface AgentToolDetails {
  /** Id of the child thread; present from the first update, absent only if the call never reached a child. */
  childThreadId?: string;
  /** The child's role (a continued child keeps the role it was spawned with). */
  role?: AgentRoleName;
  /** Tool calls the child has finished so far; updates while it runs. */
  toolCalls?: number;
  /** Billed tokens of the finished child (cache reads and writes included). */
  tokens?: number;
  /** Of `tokens`, the cache reads. */
  cacheReadTokens?: number;
  /** True when the child was stopped because the parent run was aborted. */
  aborted?: boolean;
}

type UpdateFn = (update: { content: { type: "text"; text: string }[]; details: AgentToolDetails }) => void;

/** Appended to an implementer brief when it starts beside a running explorer. */
const EXPLORER_RUNNING_NOTE = "Note: an explorer is still running; do not repeat its exploration, read only the files you need to edit.";

const text = (value: string) => [{ type: "text" as const, text: value }];

/** `runDone` resolves when the child's run is over: Pi's `agent_settled` fires once retries and compaction are done. */
function runWaiter(session: AgentSession, onToolEnd: (toolName: string, isError: boolean) => void) {
  let finish!: () => void;
  const runDone = new Promise<void>((resolve) => (finish = resolve));
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_end") onToolEnd(event.toolName, event.isError);
    if (event.type === "agent_settled") finish();
  });
  return { runDone, unsubscribe };
}

/**
 * Runs one sub-agent task: spawn (or continue) a child thread, send it the brief, wait for it to
 * finish and return only its final assistant message. Exported for tests; the extension wraps it.
 */
export function createAgentRunner(opts: AgentToolOptions) {
  const { threads, ref } = opts;
  /** A role whose file replaces the whole prompt defines its own report format. */
  const roleHasOwnFormat = (role: AgentRoleName | undefined) => !!role && roleOf(role, opts.roles ?? ROLES).promptMode === "replace";
  /** Calls in flight, counted before any await so parallel calls in one turn cannot exceed the limit. */
  let active = 0;
  const busy = new Set<string>();
  /** Calls in flight with their role and (once spawned) child id, to spot an implementer started beside the explorer it depends on. Registered before any await so same-turn calls see each other. */
  const inflight = new Map<symbol, { role?: AgentRoleName; childId?: string }>();

  return async function runAgent(params: AgentToolParams, signal?: AbortSignal, onUpdate?: UpdateFn) {
    if (active >= MAX_RUNNING_CHILDREN) {
      throw new Error(`Too many sub-agents are running (${MAX_RUNNING_CHILDREN}). Wait for one to finish, or do the work yourself.`);
    }
    if (!params.continueId && !params.role) throw new Error("role is required unless continueId is set.");
    if (!params.goal?.trim()) throw new Error("The goal is empty: describe what done looks like for the sub-agent.");
    if (!params.continueId && params.role === "implementer" && !params.acceptance?.trim()) throw new Error("acceptance is required for an implementer: give the command that must pass or the behaviour to verify.");
    const problem = briefProblem({ goal: params.goal, constraints: params.constraints });
    if (problem) throw new Error(problem);
    if (signal?.aborted) return { content: text("Aborted before the sub-agent started."), details: { aborted: true } as AgentToolDetails };
    active++;
    // getSessionStats is cumulative for the child thread, so a continued child reports its whole thread.
    const tokenLabel = (n: number) => `${params.continueId ? "thread total " : ""}${n} tokens`;
    const key = Symbol();
    const mine: { role?: AgentRoleName; childId?: string } = { role: params.role };
    inflight.set(key, mine);
    let unsubscribe = () => {};
    let timer: NodeJS.Timeout | undefined;
    let onAbort = () => {};
    try {
      let childId: string;
      if (params.continueId) {
        childId = params.continueId;
        const existing = await threads.continueChild(childId).catch(() => undefined);
        if (!existing || existing.summary.parentId !== ref.threadId) throw new Error(`continueId ${childId} is not a sub-agent thread of this thread.`);
        if (busy.has(childId) || existing.session.isStreaming) throw new Error(`Sub-agent ${childId} is still running.`);
      } else {
        childId = await threads.spawnChild(ref.threadId, { role: params.role! });
      }
      busy.add(childId);
      mine.childId = childId;
      try {
        const child = await threads.continueChild(childId);
        const role = child.summary.role ?? params.role;
        mine.role = role;
        const who = role ? `${role} sub-agent` : "sub-agent";
        let toolCalls = 0;
        const update = (line: string) => onUpdate?.({ content: text(line), details: { childThreadId: childId, role, toolCalls } });
        // The signal aborted while the child was being set up: leave it idle and never send the brief.
        if (signal?.aborted) return { content: text(`Aborted before the ${who} started (thread ${childId}).`), details: { childThreadId: childId, role, toolCalls, aborted: true } as AgentToolDetails };
        update(`Started ${who}.`);
        let brief = composeBrief(params, !!params.continueId);
        if (role === "implementer") {
          const explorer = [...inflight].find(([k, v]) => k !== key && v.role === "explorer")?.[1];
          if (explorer) {
            brief += `\n\n${EXPLORER_RUNNING_NOTE}`;
            opts.record?.({
              kind: "agent_dispatch",
              summary: "Warning: implementer dispatched while explorer still running",
              reason: "The implementer cannot use the explorer's findings and will repeat its exploration; dispatch it after the explorer reports.",
              data: { explorerChildThreadId: explorer.childId ?? null, implementerChildThreadId: childId },
            });
          }
        }
        opts.record?.({
          kind: "agent_dispatch",
          summary: `Dispatch ${role ?? "sub-agent"}: ${clip(params.goal, 80)}`,
          ...(params.reason?.trim() ? { reason: clip(params.reason, 300) } : {}),
          data: { role: role ?? null, childThreadId: childId, continueId: params.continueId ?? null },
        });
        /** Logs how the dispatch ended; `evidence` is the start of what the child said (or the error). */
        let logged = false;
        const logResult = (outcome: "done" | "aborted" | "timeout" | "error", evidence?: string) => {
          logged = true;
          let tokens = 0;
          let cacheRead = 0;
          try {
            ({ billed: tokens, cacheRead } = usageTotals(child.session.getSessionStats().tokens));
          } catch {}
          const label = role ?? "sub-agent";
          opts.record?.({
            kind: "agent_result",
            summary: outcome === "done" ? `${label} done: ${toolCalls} tool calls, ${tokenLabel(tokens)}` : `${label} ${outcome}`,
            ...(evidence ? { evidence: evidence.slice(0, 300) } : {}),
            data: { childThreadId: childId, outcome, toolCalls, tokens, cacheReadTokens: cacheRead },
          });
        };
        try {
          // `edit` and `write` are the tools that reliably mean "files changed"; a file changed through bash is not detected.
          let edited = false;
          const stopped = new Promise<"aborted" | "timeout">((resolve) => {
            onAbort = () => resolve("aborted");
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) onAbort();
            timer = setTimeout(() => resolve("timeout"), opts.timeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS);
          });
          let stopReason: "aborted" | "timeout" | undefined;
          // Verify commands are bounded by the same stop as the child.
          const verifyAbort = new AbortController();
          void stopped.then((reason) => {
            stopReason = reason;
            verifyAbort.abort();
          });
          // The config as it was before the child ran: a child that rewrites verify.json must not choose what the host runs.
          const cwd = child.session.sessionManager.getCwd();
          const before = opts.verify ? resolveVerifyConfig(opts.verify.store, cwd) : undefined;
          /** One prompt and the wait for the run to settle, racing the abort and the timeout. */
          const turn = async (prompt: string) => {
            // Subscribe before prompting so a fast run cannot finish unobserved.
            const waiter = runWaiter(child.session, (toolName, isError) => {
              if (!isError && (toolName === "edit" || toolName === "write")) edited = true;
              update(`${who} working: ${++toolCalls} tool calls.`);
            });
            // startPrompt's run rejects when Pi cannot start the run (no model, auth, ...): no agent_settled would follow.
            const finished = threads.startPrompt(childId, prompt, undefined).then(({ run }) => run).then(() => waiter.runDone.then(() => "finished" as const));
            finished.catch(() => {}); // an abort or timeout can win the race; do not leave a late rejection unhandled
            try {
              return await Promise.race([stopped, finished]);
            } finally {
              waiter.unsubscribe();
            }
          };
          let outcome = await turn(brief);

          // Verify gate: the host runs the configured checks instead of trusting the child's "done".
          let verifyLine = "";
          const verify = opts.verify;
          if (outcome === "finished" && verify && edited) {
            const config = before;
            const skip = (reason: string) => `Verify: skipped (${reason})`;
            if (verifyKey(resolveVerifyConfig(verify.store, cwd)) !== verifyKey(before)) verifyLine = skip("verify.json changed during run");
            else if (!config) verifyLine = "";
            else if (verify.store.config.approvalMode === "read-only") verifyLine = skip("read-only approval mode");
            else {
              for (let attempt = 1; ; attempt++) {
                const result = await withProjectLock(cwd, () => runVerify(config, cwd, verify.store.toolRules, verify.run ?? shellRunner, verifyAbort.signal));
                if (stopReason || signal?.aborted) {
                  outcome = stopReason ?? "aborted";
                  break;
                }
                opts.record?.({
                  kind: "agent_result",
                  summary: `Verify ${result.status}${result.status === "failed" ? ` (attempt ${attempt}/${config.maxAttempts})` : ""}`,
                  ...(result.status === "failed" ? { evidence: result.output.slice(0, 300) } : result.status === "skipped" ? { evidence: result.reason } : {}),
                  data: { childThreadId: childId, verify: result.status, attempt },
                });
                if (result.status === "passed") verifyLine = "Verify: passed";
                else if (result.status === "skipped") verifyLine = skip(result.reason);
                else if (attempt >= config.maxAttempts) verifyLine = `Verify: failed after ${attempt} attempts (${result.command})`;
                else {
                  outcome = await turn(feedbackPrompt(result.output));
                  if (outcome === "finished" && !stopReason) continue;
                }
                break;
              }
            }
          }

          if (outcome !== "finished") {
            await threads.abort(childId);
            if (outcome === "timeout") {
              logResult("timeout");
              throw new Error(`The ${who} did not finish in time and was stopped (thread ${childId}).`);
            }
            logResult("aborted");
            return { content: text(`Aborted: the ${who} was stopped (thread ${childId}).`), details: { childThreadId: childId, role, toolCalls, aborted: true } as AgentToolDetails };
          }
          // Report format: one follow-up when the child's last message lacks the sections, then take what comes back.
          if (outcome === "finished" && opts.reportFormat !== false && !roleHasOwnFormat(role) && !hasReportSections(child.session.getLastAssistantText() ?? "", role)) {
            outcome = await turn(reportFollowUp(role));
            if (outcome !== "finished") {
              await threads.abort(childId);
              logResult(outcome);
              if (outcome === "timeout") throw new Error(`The ${who} did not finish in time and was stopped (thread ${childId}).`);
              return { content: text(`Aborted: the ${who} was stopped (thread ${childId}).`), details: { childThreadId: childId, role, toolCalls, aborted: true } as AgentToolDetails };
            }
          }
          const final = child.session.getLastAssistantText()?.trim();
          if (!final) throw new Error(`The ${who} produced no final message (thread ${childId}).`);
          const { billed: tokens, cacheRead } = usageTotals(child.session.getSessionStats().tokens);
          const footer = `[sub-agent thread ${childId}${tokens ? `, ${tokenLabel(tokens)}` : ""}]`;
          logResult("done", final);
          return { content: text(`${capReport(final)}${verifyLine ? `\n\n${verifyLine}` : ""}\n\n${footer}`), details: { childThreadId: childId, role, toolCalls, tokens, cacheReadTokens: cacheRead } as AgentToolDetails };
        } catch (error) {
          if (!logged) logResult("error", error instanceof Error ? error.message : String(error));
          throw error;
        }
      } finally {
        busy.delete(childId);
      }
    } finally {
      inflight.delete(key);
      unsubscribe();
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      active--;
    }
  };
}

export const describe = (roles: AgentRole[]) => [
  "Delegate a scoped task to a sub-agent that runs in its own thread and returns only its final message.",
  `Roles: ${roles
    .map((r) => `${r.name} (${r.description})`)
    .join(" ")}`,
  "The sub-agent sees nothing of this conversation, only what you pass. Give a goal (what done looks like), pointers (files, symbols or commands to start from), acceptance (the command that must pass; required for an implementer) and constraints (what not to touch). The sub-agent reads the code and writes the implementation: a brief containing code is rejected. It replies with a report: Changed (or Findings), Ran, Assumptions, Open questions.",
  "Delegate when the work is large or would bloat your context (wide exploration, changes across many files), or to run independent tasks in parallel (at most 3 at once). Do not use it for a step you can do in a few tool calls.",
  "Workflow: dispatch explorers first and wait for their result; put their findings and the exact files to touch into the implementer's brief. Never dispatch an implementer in the same turn as the explorer it depends on, and run one implementer at a time.",
  "Set continueId to a thread id from an earlier result to send a follow-up to that sub-agent, which keeps its context.",
  "Give a short reason for each delegation: it is shown to the user in the decision log.",
].join(" ");

export function agentToolExtension(opts: AgentToolOptions): InlineExtension {
  const run = createAgentRunner(opts);
  const roles = availableRoles(opts.roles ?? ROLES);
  return {
    name: "agent-tool",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool(
        defineTool({
          name: "agent",
          label: "Sub-agent",
          description: describe(roles),
          promptSnippet: "agent: delegate a scoped task to a sub-agent (explorer, implementer, reviewer or a custom role); returns its final report",
          parameters: Type.Object({
            role: Type.Optional(
              Type.Union(
                roles.map((r) => Type.Literal(r.name)),
                { description: "Required for a new sub-agent (ignored with continueId, which keeps its own role). explorer and reviewer are read-only; implementer can change files" },
              ),
            ),
            goal: Type.String({ description: "What done looks like, 1-3 sentences. With continueId, the follow-up message. No code." }),
            pointers: Type.Optional(Type.Array(Type.String(), { description: "Files, directories, symbols or commands worth starting from, e.g. 'apps/host/src/text.ts: clip'" })),
            acceptance: Type.Optional(Type.String({ description: "The command that must pass or the behaviour to verify. Required for an implementer" })),
            constraints: Type.Optional(Type.String({ description: "Limits, e.g. files not to touch. No code." })),
            continueId: Type.Optional(Type.String({ description: "Thread id of an earlier sub-agent to send this goal to as a follow-up instead of starting a new one" })),
            reason: Type.Optional(Type.String({ description: "One sentence on why you are delegating this (the why, not the what), e.g. 'Reading the whole module would flood my context, so an explorer summarises it.'" })),
          }),
          execute: (_id, params, signal, onUpdate) => run(params as AgentToolParams, signal, onUpdate as UpdateFn | undefined),
        }),
      );
    },
  };
}
