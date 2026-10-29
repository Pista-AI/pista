// `pnpm eval:presets --presets solo,routed --tasks '*' --runs 3 --max-usd 2 --model provider/id [--judge provider/id]`
// `--fake` swaps in a scripted model (no API calls). Each run happens in a child process with its own throwaway
// PISTA_HOME, agent dir and memory dir (see presets.ts); real runs copy only auth.json and models-store.json
// from your Pi agent dir. Exits nonzero when aborted by the cost cap or when every run errored.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { abortEval, failed, runEval, toMarkdown } from "./presets.ts";

const { values } = parseArgs({
  options: {
    presets: { type: "string", default: "solo" },
    tasks: { type: "string", default: "*" },
    runs: { type: "string", default: "1" },
    "max-usd": { type: "string" },
    "run-timeout": { type: "string" },
    model: { type: "string" },
    judge: { type: "string" },
    fake: { type: "boolean", default: false },
    out: { type: "string" },
    "no-sessions": { type: "boolean", default: false },
  },
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    abortEval();
    process.exit(130);
  });
}
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
const root = resolve(fileURLToPath(new URL("../../../../evals/presets", import.meta.url)));
const out = resolve(values.out ?? join(root, "results", new Date().toISOString().replace(/[:.]/g, "-")));
const report = await runEval({
  outDir: values["no-sessions"] ? undefined : out,
  presetsDir: join(root, "presets"),
  tasksDir: join(root, "tasks"),
  presets: values.presets!.split(",").map((s) => s.trim()).filter(Boolean),
  tasks: values.tasks!,
  runs: Number(values.runs),
  model: values.model,
  judge: values.judge,
  maxUsd: num(values["max-usd"]),
  runTimeoutSec: num(values["run-timeout"]),
  fake: values.fake,
  onRun: (r) => console.log(`${r.preset} ${r.task} #${r.run}: ${r.pass ? "pass" : "FAIL"} ${r.seconds.toFixed(1)}s $${r.costUsd.toFixed(4)}${r.error ? ` (${r.error})` : ""}`),
}).catch((error: Error) => {
  console.error(error.message);
  process.exit(2);
});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(out, "report.md"), toMarkdown(report));
console.log(toMarkdown(report) + `Written to ${out}`);
process.exit(failed(report) ? 1 : 0);
