// Side-effect module: import it before anything from the host, so pi-env sees the isolated directories.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSuiteEnv } from "./suite-env.ts";

const { set, temp } = resolveSuiteEnv(process.env, () => mkdtempSync(join(tmpdir(), "pi-browser-eval-home-")));
Object.assign(process.env, set);
if (temp) console.log(`PISTA_HOME is not set: using a fresh ${temp} (no sign-ins; set PISTA_HOME, or an API key such as NEBIUS_API_KEY, to run a model)`);

/** The temp home to delete when the run ends, if the suite made one. */
export const tempHome = temp;
