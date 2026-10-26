// `pnpm eval:presets --presets solo,routed --tasks '*' --runs 3 --max-usd 2 --model provider/id`
// `--fake` swaps in a scripted model (no API calls). Env must be set before the host is imported, so this file
// sets it and only then loads presets.ts. Real runs keep the user's Pi credentials (PI_CODING_AGENT_DIR) but use a
// throwaway PISTA_HOME, so no real project, thread or setting is touched.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    presets: { type: "string", default: "solo" },
    tasks: { type: "string", default: "*" },
    runs: { type: "string", default: "1" },
    "max-usd": { type: "string" },
    model: { type: "string" },
    fake: { type: "boolean", default: false },
    out: { type: "string" },
  },
});
const root = resolve(fileURLToPath(new URL("../../../../evals/presets", import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "pista-eval-home-"));
process.env.PISTA_HOME = join(scratch, "home");
if (values.fake) process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
mkdirSync(process.env.PISTA_HOME, { recursive: true });

const { runEval, toMarkdown } = await import("./presets.ts");
const report = await runEval({
  presetsDir: join(root, "presets"),
  tasksDir: join(root, "tasks"),
  presets: values.presets!.split(",").map((s) => s.trim()).filter(Boolean),
  tasks: values.tasks!,
  runs: Number(values.runs),
  model: values.model,
  maxUsd: values["max-usd"] === undefined ? undefined : Number(values["max-usd"]),
  fake: values.fake,
  onRun: (r) => console.log(`${r.preset} ${r.task} #${r.run}: ${r.pass ? "pass" : "FAIL"} ${r.seconds.toFixed(1)}s $${r.costUsd.toFixed(4)}${r.error ? ` (${r.error})` : ""}`),
});
const out = resolve(values.out ?? join(root, "results", new Date().toISOString().replace(/[:.]/g, "-")));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(out, "report.md"), toMarkdown(report));
console.log(toMarkdown(report) + `Written to ${out}`);
process.exit(0);
