// Side-effect module: import it first, before pi-env.ts and policy-boot.ts. `policy check` runs and exits here, so the
// host never starts and the command touches no state. Output is written synchronously so a large --json survives a pipe.
import { writeSync } from "node:fs";
import { runPolicyCheck } from "./policy-check.ts";

const args = process.argv.slice(2);
if (args[0] === "policy") {
  const write = (fd: number) => (text: string) => writeSync(fd, `${text}\n`);
  process.exit(await runPolicyCheck(args, process.env, { log: write(1), error: write(2) }));
}
