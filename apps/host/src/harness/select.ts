import type { HostConfig } from "@pista/protocol";

/** The harness id for top-level threads: `harness`, else "sliced" for the legacy `orchestratorMode: "sliced"`, else "solo". */
export function harnessIdOf(config: Pick<HostConfig, "harness" | "orchestratorMode">): string {
  if (config.harness) return config.harness;
  return config.orchestratorMode === "sliced" ? "sliced" : "solo";
}

/** A harness's settings block: `harnessConfig[id]`, falling back to the legacy `sliced` key for "sliced". */
export function harnessConfigOf(config: Pick<HostConfig, "harnessConfig" | "sliced">, id: string): unknown {
  return config.harnessConfig?.[id] ?? (id === "sliced" ? config.sliced : undefined);
}
