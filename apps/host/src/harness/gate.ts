import type { ManagedPolicy } from "@pista/protocol";

export interface HarnessDecisionInput {
  id: string;
  policy: ManagedPolicy | undefined;
  /** The `harness` setting is locked by managed policy (as opposed to chosen by the user). */
  selectedByPolicy: boolean;
  /** Built-in, or loaded from a Pi package (and whether that package is in the policy's `extensions.packages`). */
  source: "builtin" | { package: string; managedPackage: boolean };
}

export type HarnessDecision = { allow: true } | { allow: false; rule: string };

/**
 * Whether a harness may run. Fail closed: the caller falls back to solo on a deny. `solo` is always allowed.
 * Without a policy everything is allowed. With one, a package harness needs to be in `harnesses.allow` and
 * its package in the managed `extensions.packages` list, whatever the other settings say.
 */
export function harnessDecision({ id, policy, selectedByPolicy, source }: HarnessDecisionInput): HarnessDecision {
  if (id === "solo" || !policy) return { allow: true };
  const section = policy.harnesses;
  const listed = section?.allow?.includes(id) ?? false;
  if (source !== "builtin") {
    if (!listed) return { allow: false, rule: "harnesses.allow" };
    if (!source.managedPackage) return { allow: false, rule: "harnesses.packageNotManaged" };
  } else if (section?.allow && !listed) return { allow: false, rule: "harnesses.allow" };
  if (section?.allowUserHarnesses === false && !selectedByPolicy) return { allow: false, rule: "harnesses.allowUserHarnesses" };
  return { allow: true };
}
