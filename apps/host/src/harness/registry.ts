import { slicedHarness } from "./sliced.ts";
import { defineHarness, type Harness } from "./types.ts";

/** Today's default: contributes no prompt, no tools and no extension. */
export const soloHarness = defineHarness({ id: "solo" });

const BUILT_IN: Harness[] = [soloHarness, slicedHarness];

export function resolveHarness(id: string): Harness | undefined {
  return BUILT_IN.find((h) => h.id === id);
}
