import type { ManagedPolicy, UpdatesSummary, VersionGate } from "@pista/protocol";
import pkg from "../package.json" with { type: "json" };
import { compareVersions, parseVersion } from "./semver.ts";

/** PISTA_APP_VERSION (the desktop shell passes app.getVersion()) when valid semver, else this package's version.
 * package.json is imported as JSON, so tsx (dev) and the esbuild bundle (host.mjs) both carry it. */
export function resolveAppVersion(env: NodeJS.ProcessEnv, warn: (message: string) => void = () => {}): string {
  const given = env.PISTA_APP_VERSION;
  if (given) {
    if (parseVersion(given)) return given;
    warn(`PISTA_APP_VERSION "${given}" is not valid semver, ignored`);
  }
  return pkg.version;
}

type Updates = NonNullable<ManagedPolicy["updates"]>;

/** Pure: is the running version inside the range the policy allows? Unparseable inputs count as ok (the policy loader already rejects bad bounds). */
export function evaluateVersionGate(current: string, updates: Updates | undefined): VersionGate {
  const cur = parseVersion(current);
  const min = updates?.minimumVersion ? parseVersion(updates.minimumVersion) : null;
  const max = updates?.maximumVersion ? parseVersion(updates.maximumVersion) : null;
  const bounds = { ...(updates?.minimumVersion ? { minimumVersion: updates.minimumVersion } : {}), ...(updates?.maximumVersion ? { maximumVersion: updates.maximumVersion } : {}) };
  if (cur && min && compareVersions(cur, min) < 0) return { status: "below", current, ...bounds };
  if (cur && max && compareVersions(cur, max) > 0) return { status: "above", current, ...bounds };
  return { status: "ok" };
}

export function gateMessage(gate: VersionGate): string | null {
  if (gate.status === "below") return `Pista ${gate.current} is below the minimum version ${gate.minimumVersion} required by your organisation. Update Pista or contact your IT administrator.`;
  if (gate.status === "above") return `Pista ${gate.current} is above the maximum version ${gate.maximumVersion} allowed by your organisation. Install the approved version or contact your IT administrator.`;
  return null;
}

/** Non-secret updater settings for the desktop shell. The environment can only switch the updater off. */
export function updatesSummary(updates: Updates | undefined, env: NodeJS.ProcessEnv): UpdatesSummary {
  return {
    enabled: updates?.enabled !== false && env.PISTA_DISABLE_AUTOUPDATER !== "1",
    channel: updates?.channel ?? "stable",
    ...(updates?.feedUrl ? { feedUrl: updates.feedUrl } : {}),
    ...(updates?.enforcementHours !== undefined ? { enforcementHours: updates.enforcementHours } : {}),
  };
}

/** Methods that start or run agent work; blocked mode refuses exactly these. Everything else (reads, settings) keeps working. */
export const AGENT_METHODS: ReadonlySet<string> = new Set(["thread.create", "thread.prompt", "thread.compact", "thread.goal.set", "thread.goal.resume", "thread.bash"]);

export const VERSION_BLOCKED = "version_blocked";

/** The single guard: an error message for a refused method, or null to let it through. */
export function blockedReason(gate: VersionGate, method: string): string | null {
  return gate.status !== "ok" && AGENT_METHODS.has(method) ? `${VERSION_BLOCKED}: ${gateMessage(gate)}` : null;
}
