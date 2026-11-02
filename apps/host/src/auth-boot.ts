// Side-effect module: import it right after pi-env.ts and before policy-boot.ts or anything that could start a process.
// It receives the credential key first (desktop message channel, PISTA_AUTH_KEY, or plain mode) and exports it for index.ts,
// which builds the store and zeroes the buffer. A missing or bad key stops the host here.
import { currentParentPort, resolveAuthKeySource, type AuthKeySource } from "./auth-key.ts";

export const bootAuthSource: AuthKeySource = await resolveAuthKeySource(process.env, currentParentPort()).catch((error: Error) => {
  console.error(`[pista-host] ${error.message}`);
  return process.exit(1);
});
