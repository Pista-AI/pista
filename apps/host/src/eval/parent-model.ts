import type { HostConfig } from "@pista/protocol";

type ModelRef = HostConfig["defaultModel"];

/** The parent thread's model: the fake model in fake runs, else the preset's own `defaultModel` pin, else the CLI `--model`. */
export function parentModel(preset: { config: Record<string, unknown> }, fake: ModelRef, cli: ModelRef): ModelRef {
  return fake ?? (preset.config.defaultModel as ModelRef) ?? cli;
}
