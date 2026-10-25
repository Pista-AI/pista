// `pista policy sign`: wraps a policy JSON file (with an integer "serial") in a signed envelope.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { signBundle } from "./policy-remote.ts";

export const POLICY_USAGE = "Usage: pista policy check [--json]\n       pista policy sign --key <private.pem> [--out <file>] <policy.json>";
export interface Out {
  log(text: string): void;
  error(text: string): void;
}

export function runPolicySign(flags: string[], out: Out): number {
  let key: string | undefined;
  let outFile: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--key") key = flags[++i];
    else if (flags[i] === "--out") outFile = flags[++i];
    else files.push(flags[i]!);
  }
  if (!key || files.length !== 1 || (flags.includes("--out") && !outFile)) {
    out.error(POLICY_USAGE);
    return 64;
  }
  try {
    if (outFile && resolve(outFile) === resolve(key)) throw new Error("--out must not be the private key file");
    const bundle = signBundle(readFileSync(files[0]!, "utf8"), readFileSync(key, "utf8"));
    if (outFile) writeFileSync(outFile, `${bundle}\n`);
    else out.log(bundle);
    return 0;
  } catch (error) {
    out.error(`pista policy sign: ${(error as Error).message}`);
    return 1;
  }
}
