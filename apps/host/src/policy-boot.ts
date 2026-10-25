// Side-effect module: import it right after pi-env.ts and before anything that loads Pi. It loads the managed
// policy, refuses to start when the policy is required or broken, and applies network and telemetry settings
// before Pi reads them. When the policy names a signed remote source (policySource or PISTA_POLICY_URL), that policy
// is fetched (through the proxy/CA the bootstrap policy configures) and replaces the bootstrap policy.
import { CLIENT_DIR } from "./pi-env.ts";
import { applyNetwork, describeNetwork, telemetryEnv } from "./network.ts";
import { loadManagedPolicy, type LoadedPolicy } from "./policy.ts";
import { createRefresher, resolveBootPolicy } from "./policy-remote-boot.ts";
import { clampTimerMs } from "./timers.ts";

const die = (message: string): never => {
  console.error(`[pista-host] ${message}. Refusing to start.`);
  return process.exit(1);
};

function apply(loaded: LoadedPolicy): void {
  Object.assign(process.env, telemetryEnv(loaded.policy?.telemetry));
  try {
    const line = describeNetwork(applyNetwork(loaded.policy?.network));
    if (line) console.log(line);
  } catch (error) {
    die((error as Error).message);
  }
}

const bootstrap = loadManagedPolicy();
if (bootstrap.failure && !bootstrap.missing) die(bootstrap.failure); // a missing policy may still be satisfied by PISTA_POLICY_URL
apply(bootstrap);

const boot = await resolveBootPolicy({ env: process.env, loaded: bootstrap, cacheDir: CLIENT_DIR });
if (boot.failure) die(boot.failure);
export const loadedPolicy: LoadedPolicy = boot.loaded;
if (boot.serial !== undefined) {
  // Only re-apply when the remote policy changes what the bootstrap policy set.
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  if (changed(bootstrap.policy?.network, loadedPolicy.policy?.network) || changed(bootstrap.policy?.telemetry, loadedPolicy.policy?.telemetry)) {
    // What the bootstrap policy wrote into the environment must not outlive a remote policy that does not set it.
    const was = bootstrap.policy?.network;
    const now = loadedPolicy.policy?.network;
    if (was?.proxy && !now?.proxy) for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) delete process.env[name];
    if (was?.noProxy && !now?.noProxy) delete process.env.NO_PROXY;
    apply(loadedPolicy);
  }
}
if (boot.source) {
  if (boot.serial !== undefined) console.log(`[pista-host] managed policy from ${boot.source.url} (serial ${boot.serial})`);
  const tick = createRefresher({ source: boot.source, cacheDir: CLIENT_DIR, serial: boot.serial ?? -1 });
  setInterval(() => void tick(), clampTimerMs(boot.source.refreshMinutes * 60_000)).unref();
}
