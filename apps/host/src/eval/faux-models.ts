// Shared by test-helpers.ts and the eval runner (kept free of node:test so production-side code can import it).
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Registers pi-ai's faux provider on `models` (a fresh offline runtime by default).
 * pnpm keeps pi-ai next to pi-coding-agent but not in the host's own node_modules; it is not a declared
 * dependency, so it is loaded untyped through the real path.
 */
export async function fauxModels(models?: ModelRuntime, opts: { contextWindow?: number } = {}) {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const piAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const piAiEntry = join(dirname(dirname(dirname(realpathSync(piAgentEntry)))), "pi-ai/dist/index.js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const piAi: any = await import(pathToFileURL(piAiEntry).href);
  const faux = piAi.fauxProvider(opts.contextWindow ? { models: [{ id: "faux-model", contextWindow: opts.contextWindow }] } : {});
  const runtime = models ?? (await ModelRuntime.create({ allowModelNetwork: false }));
  runtime.registerNativeProvider(faux.provider);
  const model = faux.getModel();
  return { piAi, faux, models: runtime, ref: { provider: model.provider as string, id: model.id as string } };
}
