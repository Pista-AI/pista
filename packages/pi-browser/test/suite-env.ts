import { join } from "node:path";

/**
 * Where the eval suite keeps Pi's state. The suite must never touch the user's real ~/.pista or copy their ~/.pi/agent, so unless the caller
 * names a home (PISTA_HOME or PI_CODING_AGENT_DIR) it gets a fresh temp dir. The agent and memory dirs are always set explicitly, because pista's
 * pi-env migrates the Pi CLI's ~/.pi/agent into any agent dir it chose itself.
 * Returns the variables to set and the temp dir to delete afterwards (if one was made).
 */
export function resolveSuiteEnv(env: Record<string, string | undefined>, makeTemp: () => string): { set: Record<string, string>; temp?: string } {
  const set: Record<string, string> = {};
  let temp: string | undefined;
  if (!env.PISTA_HOME && !env.PI_CODING_AGENT_DIR) {
    temp = makeTemp();
    set.PISTA_HOME = temp;
  }
  const home = env.PISTA_HOME ?? set.PISTA_HOME;
  const agentDir = env.PI_CODING_AGENT_DIR ?? (home ? join(home, "pi") : undefined);
  if (!env.PI_CODING_AGENT_DIR && agentDir) set.PI_CODING_AGENT_DIR = agentDir;
  if (!env.PI_MEMORY_DIR && agentDir) set.PI_MEMORY_DIR = join(agentDir, "memory");
  return { set, temp };
}
