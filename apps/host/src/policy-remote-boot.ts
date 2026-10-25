// Decides which policy the host runs with when a signed remote policy is configured, and refreshes it. Kept apart
// from policy-boot.ts (a side-effect module) so it can be tested. The remote policy replaces the bootstrap policy entirely.
import type { LoadedPolicy, RemoteSource } from "./policy.ts";
import { remoteSourceFromEnv, resolveRemotePolicy } from "./policy-remote.ts";

export interface BootDeps {
  env: NodeJS.ProcessEnv;
  loaded: LoadedPolicy;
  cacheDir: string;
  fetch?: typeof fetch;
  readKeyFile?: (path: string) => string;
  readOnly?: boolean;
}

export interface BootResult {
  loaded: LoadedPolicy;
  /** The remote source in use (env wins over the bootstrap policy's policySource); undefined when none is configured. */
  source?: RemoteSource;
  /** Serial of the remote policy now in force; undefined when the bootstrap policy was kept. */
  serial?: number;
  origin?: "fetched" | "cache";
  cacheAgeMs?: number;
  /** Why the remote policy could not be used (set whenever a source is configured and resolving failed). */
  error?: string;
  /** Set when the host must not start. */
  failure?: string;
}

export async function resolveBootPolicy(deps: BootDeps): Promise<BootResult> {
  const { env } = deps;
  let loaded = deps.loaded;
  const fromEnv = remoteSourceFromEnv(env);
  if (fromEnv && "failure" in fromEnv) return { loaded, failure: fromEnv.failure };
  // "No policy found" under PISTA_REQUIRE_POLICY=1 is satisfied by a remote source from the environment (a server deployment with no local file); any other bootstrap failure stands.
  if (loaded.failure) {
    if (!loaded.missing || !fromEnv) return { loaded, failure: loaded.failure };
    const { failure: _failure, missing: _missing, ...rest } = loaded;
    loaded = rest;
  }
  const source = fromEnv?.source ?? loaded.remote;
  if (!source) return { loaded };
  const res = await resolveRemotePolicy({ source, cacheDir: deps.cacheDir, fetch: deps.fetch, readKeyFile: deps.readKeyFile, readOnly: deps.readOnly });
  if (!res.ok) {
    const error = `policy URL: ${res.reason}`;
    if (env.PISTA_REQUIRE_POLICY === "1") return { loaded, source, error, failure: error };
    return { loaded: { ...loaded, warnings: [...loaded.warnings, ...res.warnings, `${error}; keeping the bootstrap policy`] }, source, error };
  }
  const remote: LoadedPolicy = { ...res.policy, source: `${source.url} (${res.origin}, serial ${res.serial})`, sourceKind: "url", warnings: [...res.policy.warnings, ...res.warnings] };
  return { loaded: remote, source, serial: res.serial, origin: res.origin, ...(res.cacheAgeMs !== undefined ? { cacheAgeMs: res.cacheAgeMs } : {}) };
}

/** One refresh tick. Logs once per newer serial; there is no hot apply, the host must restart. Never throws. */
export function createRefresher(opts: { source: RemoteSource; cacheDir: string; serial: number; fetch?: typeof fetch; readKeyFile?: (path: string) => string; log?: (line: string) => void }): () => Promise<void> {
  let announced = opts.serial;
  const log = opts.log ?? console.log;
  return async () => {
    try {
      const res = await resolveRemotePolicy({ source: opts.source, cacheDir: opts.cacheDir, fetch: opts.fetch, readKeyFile: opts.readKeyFile });
      if (res.ok && res.serial > announced) {
        announced = res.serial;
        log(`[pista-host] managed policy updated to serial ${res.serial}; restart Pista to apply it`);
      }
    } catch (error) {
      log(`[pista-host] policy refresh failed: ${(error as Error).message}`);
    }
  };
}
