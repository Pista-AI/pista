import type { ModelRef } from "@pista/protocol";

// Dependency-free on purpose: goal.ts and its tests import this without loading the Pi SDK.

/** Pi reports an "unknown" placeholder model when no provider is signed in. */
export function usableModel<M extends ModelRef>(model: M | undefined): M | undefined {
  return model && model.provider !== "unknown" ? model : undefined;
}

/** Just the provider and id of a usable model, or undefined for no model or the placeholder. */
export function modelRef(model: ModelRef | undefined): ModelRef | undefined {
  const usable = usableModel(model);
  return usable && { provider: usable.provider, id: usable.id };
}

/** Token counts as Pi reports them, on an assistant message `usage` or `getSessionStats().tokens`. */
export interface UsageCounts {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** What a run was billed: cache reads and writes count (the provider quota counts them), so `billed` is the real cost. */
export function usageTotals(usage: UsageCounts): { billed: number; output: number; cacheRead: number } {
  const input = usage.input || 0;
  const output = usage.output || 0;
  const cacheRead = usage.cacheRead || 0;
  const cacheWrite = usage.cacheWrite || 0;
  return { billed: input + output + cacheRead + cacheWrite, output, cacheRead };
}

/** The model with its per-response output cap clamped to `config.maxOutputTokens`; the same object when no clamp applies. */
export function capModel<M extends { maxTokens: number }>(model: M, config: { maxOutputTokens?: number }): M {
  const cap = config.maxOutputTokens;
  return cap === undefined || cap >= model.maxTokens ? model : { ...model, maxTokens: cap };
}
