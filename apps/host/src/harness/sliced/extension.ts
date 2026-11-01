import { defineTool, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import type { HostConfig } from "@pista/protocol";
import { Type } from "typebox";
import { READ_ONLY_TOOLS } from "../../roles.ts";
import { ENTRY } from "../../session.ts";
import { clip } from "../../text.ts";
import { validateSlices, type SliceBoard, type SliceStatus } from "./board.ts";
import { decide, resolveSlicedConfig } from "./decide.ts";
import { estimateRepoTokens } from "./estimate.ts";
import { renderBoard } from "./render.ts";
import { capRequest, runSchedule, type SliceRunner } from "./schedule.ts";

export interface SlicedDeps {
  cwd: string;
  config: () => HostConfig["sliced"];
  /** `HostConfig.contextWindowCap`: the window the thread is held to, whatever the model advertises. */
  windowCap?: () => number | undefined;
  /** The thread's latest persisted board (see `readSliceBoard`). */
  readBoard: () => SliceBoard | undefined;
  /** Runs one implementer child; shared with the `agent` tool. */
  runAgent: SliceRunner;
}

/** Longest slice report copied into the dispatch result. */
const REPORT_CLIP = 1500;

/** Times the harness reminds the parent to call `slices` before it lets the run continue solo. */
const MAX_NUDGES = 2;
const TERMINAL: SliceStatus[] = ["done", "failed", "skipped"];
const MESSAGE_TYPE = "pista.sliced";
// No notion of read-only web, browser or MCP tools exists in the role gate, so only the built-in read-only tools pass in the plan phase.
const PLAN_TOOLS = ["slices", "plan", ...READ_ONLY_TOOLS];
// `agent` stays so the parent can re-dispatch a fix to an earlier child with continueId.
const INTEGRATE_READ_ONLY_TOOLS = ["agent", "plan", ...READ_ONLY_TOOLS];
/** `readOnly`: the parent cannot run commands, so it has an agent run the checks. */
export const integratePrompt = (readOnly: boolean) =>
  `Verify, do not rewrite: ${readOnly ? "have an agent run the project's own checks (tests, typecheck) and read" : "run the project's own checks (tests, typecheck) and read"} the diffs of the changed files against the request. Make a change only when a check fails or two slices conflict; do not re-implement a slice that passes. Report failed or skipped slices honestly.`;
/** Times the harness asks the parent to mention failed or skipped slices in its final answer. */
const MAX_INTEGRATE_NUDGES = 1;

const emptyBoard = (): SliceBoard => ({ slices: [], fitsSolo: false, reason: "", phase: "plan", status: {}, nudges: 0, integrateNudges: 0 });

/** True when the (lower-case) answer names the slice: its id as a whole word, so a short id like "a" does not match inside other words, or its title. */
function mentions(answer: string, slice: { id: string; title: string }): boolean {
  const escaped = slice.id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, "u").test(answer) || answer.includes(slice.title.toLowerCase());
}

/** Text of the last assistant message, or "" when there is none. */
function lastAssistantText(messages: { role: string; content?: unknown }[]): string {
  const last = messages.findLast((m) => m.role === "assistant");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return Array.isArray(last.content) ? last.content.map((c: { type?: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : "")).join("\n") : "";
}

/**
 * Sliced orchestrator mode, plan phase: the parent must call `slices` before changing anything, and the harness
 * (not the model) decides from that list whether to continue solo or dispatch.
 */
export function slicedExtension(deps: SlicedDeps): InlineExtension {
  return {
    name: "sliced",
    factory: (pi: ExtensionAPI) => {
      let board: SliceBoard | undefined;
      const current = () => (board ??= deps.readBoard() ?? emptyBoard());
      const save = (next: SliceBoard) => {
        board = next;
        pi.appendEntry(ENTRY.slices, next);
      };
      const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
      // Set by the gate when the model tried a tool the plan phase blocks during this run.
      let blockedThisRun = false;
      const note = (content: string) => pi.sendMessage({ customType: MESSAGE_TYPE, content, display: false }, { deliverAs: "steer" });

      pi.registerTool(
        defineTool({
          name: "slices",
          label: "Slices",
          description:
            "Call this first for any request that changes code. Split the request into independently verifiable slices (each with a command or behaviour that proves it); say whether it fits a single agent and why.",
          promptSnippet: "slices: split a code-changing request into independently verifiable slices before starting",
          parameters: Type.Object({
            slices: Type.Array(
              Type.Object({
                id: Type.String(),
                title: Type.String(),
                goal: Type.String(),
                files_or_areas: Type.Array(Type.String(), { description: "Files or directories the slice touches" }),
                acceptance: Type.String({ description: "A command or observable behaviour that proves the slice is done" }),
                depends_on: Type.Optional(Type.Array(Type.String(), { description: "Ids of slices that must finish first" })),
              }),
            ),
            fits_solo: Type.Boolean({ description: "True when a single agent can do the whole request" }),
            reason: Type.String({ description: "Why it does or does not fit a single agent" }),
          }),
          execute: async (_id, params, signal, onUpdate, ctx) => {
            const checked = validateSlices(params.slices.map(({ files_or_areas, depends_on, ...rest }) => ({ ...rest, filesOrAreas: files_or_areas, dependsOn: depends_on })));
            if (!checked.ok) return text(`Error: ${checked.error}. Call \`slices\` again with a corrected list.`);
            const next: SliceBoard = { slices: checked.slices, fitsSolo: params.fits_solo, reason: params.reason, phase: "plan", status: Object.fromEntries(checked.slices.map((s) => [s.id, "pending" as const])), nudges: current().nudges, integrateNudges: 0, request: current().request };
            const cap = deps.windowCap?.();
            const window = Math.min(ctx.model?.contextWindow || Infinity, cap ?? Infinity);
            const decision = decide(next, resolveSlicedConfig(deps.config()), await estimateRepoTokens(deps.cwd), Number.isFinite(window) ? window : 0);
            if (decision.kind === "solo") {
              save({ ...next, phase: "solo" });
              return text(`Proceed solo: ${decision.reason}. Board:\n${renderBoard(next)}`);
            }
            save({ ...next, phase: "dispatch" });
            const { board: done, results } = await runSchedule({
              board: { ...next, phase: "dispatch" },
              cwd: deps.cwd,
              waves: decision.waves,
              runAgent: deps.runAgent,
              persist: save,
              signal,
              onUpdate: (line) => onUpdate?.({ content: [{ type: "text", text: line }], details: {} }),
            });
            save({ ...done, phase: "integrate" });
            const reports = done.slices.map((s) => `## ${s.id} ${done.status[s.id]}${results[s.id]?.note ? ` (${results[s.id]!.note})` : ""}\n${clip(results[s.id]?.report ?? "", REPORT_CLIP)}`);
            return text(`Dispatch finished.\n${renderBoard(done)}\n\n${reports.join("\n\n")}\n\n${integratePrompt(deps.config()?.integrateTools === "read-only")}`);
          },
        }),
      );

      // A new user message starts a new board unless the previous one still has unfinished slices.
      pi.on("before_agent_start", (event) => {
        if (event.messageType !== "user") return;
        blockedThisRun = false;
        const b = current();
        // An integrate board stays until the parent has settled, so unreported failed or skipped slices are not lost.
        if (b.phase === "integrate") return;
        if (b.phase !== "solo" && b.phase !== "done" && !Object.values(b.status).every((s) => TERMINAL.includes(s))) return;
        // The prompt that starts a plan is kept verbatim so every child brief can quote it.
        const request = capRequest(event.prompt);
        const pristine = b.phase === "plan" && b.slices.length === 0 && b.nudges === 0;
        if (pristine) save({ ...b, request });
        else save({ ...emptyBoard(), request });
      });

      pi.on("tool_call", (event) => {
        const phase = current().phase;
        if (phase === "integrate") {
          if (deps.config()?.integrateTools !== "read-only" || INTEGRATE_READ_ONLY_TOOLS.includes(event.toolName)) return undefined;
          return { block: true, reason: `Blocked: during integration only ${INTEGRATE_READ_ONLY_TOOLS.join(", ")} are allowed.` };
        }
        if (phase !== "plan" || PLAN_TOOLS.includes(event.toolName)) return undefined;
        blockedThisRun = true;
        return { block: true, reason: `Blocked: call \`slices\` first. Until then only ${PLAN_TOOLS.join(", ")} are allowed.` };
      });

      // The parent is about to end its turn in the plan phase. A run that never tried a blocked tool was a chat answer, so the
      // gate is lifted silently; one that did is reminded to call `slices`, at most MAX_NUDGES times, then left to run solo.
      pi.on("agent_before_settle", (event) => {
        const b = current();
        if (event.outcome !== "completed") {
          // An aborted or failed run ends integration, so a read-only gate never outlives it (or a reload).
          if (b.phase === "integrate") save({ ...b, phase: "done" });
          return undefined;
        }
        if (b.phase === "integrate") {
          // The answer must own up to every slice that did not land; one reminder, then the board is closed either way.
          const answer = lastAssistantText(event.context.contextMessages as { role: string; content?: unknown }[]).toLowerCase();
          const missing = b.slices.filter((s) => (b.status[s.id] === "failed" || b.status[s.id] === "skipped") && !mentions(answer, s));
          if (missing.length === 0 || (b.integrateNudges ?? 0) >= MAX_INTEGRATE_NUDGES) {
            save({ ...b, phase: "done" });
            return undefined;
          }
          save({ ...b, integrateNudges: (b.integrateNudges ?? 0) + 1 });
          note(`Your answer must mention the failed/skipped slices: ${missing.map((s) => s.id).join(", ")}`);
          return { continue: true };
        }
        if (b.phase !== "plan") return undefined;
        if (!blockedThisRun || b.nudges >= MAX_NUDGES) {
          save({ ...b, phase: "solo" });
          return undefined;
        }
        blockedThisRun = false;
        save({ ...b, nudges: b.nudges + 1 });
        note("Split the request with the `slices` tool before doing anything else.");
        return { continue: true };
      });

      // The board rides along at the end of every request; it is not stored in the transcript.
      pi.on("context", (event) => {
        const b = current();
        if (b.slices.length === 0) return undefined;
        return { messages: [...event.messages, { role: "user", content: [{ type: "text", text: `Slice board (${b.phase}):\n${renderBoard(b)}` }], timestamp: Date.now() }] };
      });
    },
  };
}
