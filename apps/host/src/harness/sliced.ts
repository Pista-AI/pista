import { orchestratorPrompt } from "../roles.ts";
import { validSliced } from "../policy.ts";
import { ENTRY } from "../session.ts";
import { slicedExtension } from "../sliced/extension.ts";
import type { SliceBoard } from "../sliced/board.ts";
import type { HostConfig } from "@pista/protocol";
import { defineHarness } from "./types.ts";

/** The sliced orchestrator mode behind the harness interface; `slicedExtension` stays where it is. */
export const slicedHarness = defineHarness({
  id: "sliced",
  prompt: () => orchestratorPrompt("sliced"),
  extension: (host) =>
    slicedExtension({
      cwd: host.cwd,
      config: () => host.config<HostConfig["sliced"]>(),
      windowCap: () => host.windowCap(),
      readBoard: () => host.state.read<SliceBoard>(ENTRY.slices),
      runAgent: host.runAgent,
    }),
  validateConfig: validSliced,
  entries: [ENTRY.slices],
});
