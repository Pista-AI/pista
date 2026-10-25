import type { ConfigPatch, HostConfig } from "@pista/protocol";
import { actions, useApp } from "./store.ts";

/** One setting: its value, a writer, whether an organisation policy has locked it, and where its value comes from. Every General-tab control goes through this. */
export function useConfigField<K extends keyof HostConfig>(key: K) {
  const value = useApp((s) => s.config?.[key]);
  const locked = useApp((s) => s.policy.locked.includes(key));
  const source = useApp((s) => s.configSources[key]);
  const policySource = useApp((s) => s.policySource);
  const set = (next: ConfigPatch[K]) => (locked ? Promise.resolve() : actions.patchConfig({ [key]: next } as ConfigPatch));
  return { value, set, locked, source, policySource };
}
