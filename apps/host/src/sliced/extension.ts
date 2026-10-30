import { defineTool, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import type { HostConfig } from "@pista/protocol";
import { Type } from "typebox";
import { READ_ONLY_TOOLS } from "../roles.ts";
import { ENTRY } from "../session.ts";
import { validateSlices, type SliceBoard, type SliceStatus } from "./board.ts";
import { decide, resolveSlicedConfig } from "./decide.ts";
import { estimateRepoTokens } from "./estimate.ts";
import { renderBoard } from "./render.ts";

export interface SlicedDeps {
  cwd: string;
  config: () => HostConfig["sliced"];
  /** The thread's latest persisted board (see `readSliceBoard`). */
  readBoard: () => SliceBoard | undefined;
}

/** Times the harness reminds the parent to call `slices` before it lets the run continue solo. */
const MAX_NUDGES = 2;
const TERMINAL: SliceStatus[] = ["done", "failed", "skipped"];
const PLAN_TOOLS = ["slices", "plan", ...READ_ONLY_TOOLS];

const emptyBoard = (): SliceBoard => ({ slices: [], fitsSolo: false, reason: "", phase: "plan", status: {}, nudges: 0 });

/**
 * Sliced orchestrator mode, plan phase: the parent must call `slices` before changing anything, and the harness
 * (not the model) decides from that list whether to continue solo or dispatch. Dispatch itself is not wired yet.
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
      const note = (content: string) => pi.sendMessage({ customType: "pista.sliced", content, display: false }, { deliverAs: "steer" });

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
          execute: async (_id, params, _signal, _onUpdate, ctx) => {
            const checked = validateSlices(params.slices.map(({ files_or_areas, depends_on, ...rest }) => ({ ...rest, filesOrAreas: files_or_areas, dependsOn: depends_on })));
            if (!checked.ok) return text(`Error: ${checked.error}. Call \`slices\` again with a corrected list.`);
            const next: SliceBoard = { slices: checked.slices, fitsSolo: params.fits_solo, reason: params.reason, phase: "plan", status: Object.fromEntries(checked.slices.map((s) => [s.id, "pending" as const])), nudges: current().nudges };
            const decision = decide(next, resolveSlicedConfig(deps.config()), await estimateRepoTokens(deps.cwd), ctx.model?.contextWindow ?? 0);
            if (decision.kind === "solo") {
              save({ ...next, phase: "solo" });
              return text(`Proceed solo: ${decision.reason}. Board:\n${renderBoard(next)}`);
            }
            // TODO(step 3): run `decision.waves` with implementer children. Until then nothing is dispatched, so the slices are
            // marked skipped (a later user message may start a new board) and the gate is lifted.
            save({ ...next, phase: "dispatch", status: Object.fromEntries(checked.slices.map((s) => [s.id, "skipped" as const])) });
            return text("Dispatch not yet wired in this build; proceed solo.");
          },
        }),
      );

      // A new user message starts a new board unless the previous one still has unfinished slices.
      pi.on("before_agent_start", (event) => {
        if (event.messageType !== "user") return;
        const b = current();
        if (b.phase !== "solo" && b.phase !== "done" && !Object.values(b.status).every((s) => TERMINAL.includes(s))) return;
        const pristine = b.phase === "plan" && b.slices.length === 0 && b.nudges === 0;
        if (pristine) board = b;
        else save(emptyBoard());
      });

      pi.on("tool_call", (event) => {
        if (current().phase !== "plan" || PLAN_TOOLS.includes(event.toolName)) return undefined;
        return { block: true, reason: `Blocked: call \`slices\` first. Until then only ${PLAN_TOOLS.join(", ")} are allowed.` };
      });

      // The parent tried to end its turn without a valid slice list.
      pi.on("agent_before_settle", () => {
        const b = current();
        if (b.phase !== "plan") return undefined;
        if (b.nudges >= MAX_NUDGES) {
          save({ ...b, phase: "solo" });
          note("No slice list arrived; continuing without one. All tools are available.");
        } else {
          save({ ...b, nudges: b.nudges + 1 });
          note("Split the request with the `slices` tool before doing anything else.");
        }
        return { continue: true };
      });

      // The board rides along at the end of every request; it is not stored in the transcript.
      pi.on("context", (event) => {
        if (!board || board.slices.length === 0) return undefined;
        return { messages: [...event.messages, { role: "user", content: [{ type: "text", text: `Slice board (${board.phase}):\n${renderBoard(board)}` }], timestamp: Date.now() }] };
      });
    },
  };
}
