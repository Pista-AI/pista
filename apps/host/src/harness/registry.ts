import { slicedHarness } from "./sliced/index.ts";
import { defineHarness, type Harness } from "./types.ts";

/** Today's default: contributes no prompt, no tools and no extension. */
export const soloHarness = defineHarness({ id: "solo" });

const BUILT_IN: Harness[] = [soloHarness, slicedHarness];

/** Where a harness came from; the policy gate treats package harnesses more strictly. */
export type HarnessSource = "builtin" | { package: string; managedPackage: boolean };

// A registered package harness stays until restart (an uninstall at runtime is not tracked); the gate re-runs on every thread build anyway.
const registered = new Map<string, { harness: Harness; source: Exclude<HarnessSource, "builtin"> }>();

/** Adds a harness loaded from a Pi package. A built-in id cannot be replaced; the first registration of an id wins. */
export function registerHarness(h: Harness, source: Exclude<HarnessSource, "builtin">): boolean {
  if (BUILT_IN.some((b) => b.id === h.id)) {
    console.warn(`[pista-host] harness package ${source.package}: id ${h.id} is built in; ignored`);
    return false;
  }
  if (registered.has(h.id)) return false;
  registered.set(h.id, { harness: h, source });
  return true;
}

export function resolveHarness(id: string): Harness | undefined {
  return BUILT_IN.find((h) => h.id === id) ?? registered.get(id)?.harness;
}

/** Built-in harnesses first, then registered package harnesses in registration order. */
export function listHarnesses(): Harness[] {
  return [...BUILT_IN, ...[...registered.values()].map((r) => r.harness)];
}

export function harnessSource(id: string): HarnessSource {
  return registered.get(id)?.source ?? "builtin";
}

/** Test hook. */
export function clearRegisteredHarnesses(): void {
  registered.clear();
}
