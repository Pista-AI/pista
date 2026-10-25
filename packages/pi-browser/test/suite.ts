/**
 * Measured raw-tools suite: real tasks, headless, through the CDP driver (never touches the app's browser pane). A Pi session built the way
 * the host builds one (apps/host/src/session.ts buildSession) gets the browser_* tools and the goal as its prompt; the model drives the tools itself.
 *
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/pi-browser-test
 *   MODEL=openai-codex/gpt-6-luna pnpm eval:browser [task-name ...]
 *   LLAMA_BASE_URL=http://127.0.0.1:8080 MODEL=llama.cpp/<model id> pnpm eval:browser fixture-form
 *
 * MODEL is "<provider>/<model id>"; the id may contain slashes (nebius/deepseek-ai/DeepSeek-V4-Flash-0731). Nebius is registered the way the host
 * does it (NEBIUS_API_KEY). With LLAMA_BASE_URL set (a llama-server, URL without /v1) the `llama.cpp` provider is registered like the host's built-in
 * runtime does (the advertised context window is 32768, or LLAMA_CONTEXT; the server's -c must be at least that or the session auto-compacts
 * after a snapshot or two). SUITE_TASKS=a,b picks tasks like the positional names do. PI_BROWSER_CDP_URL points at the Chrome (default
 * http://127.0.0.1:9222). THINKING=off|minimal|low|medium|high sets the thinking level. TASK_TIMEOUT_S bounds each task (default 300).
 * The fixture pages are served on 127.0.0.1:8765 by the suite itself unless something already listens there.
 *
 * SUITE_SET=default|heldout|all picks the task set (default: the development set below). `heldout` is the held-out set in heldout-tasks.ts (names
 * start with `ho-`; never tune against it). Task names (positional or SUITE_TASKS) select within the chosen set; a name outside it is reported and
 * ignored, so use SUITE_SET=all to mix. SUITE_REPEAT=N or `--repeat N` runs each selected task N times (default 1), sequentially, each in a fresh
 * session; the flag is not a task name. Every run prints a greppable line: RESULT<TAB>task<TAB>run<TAB>PASS|FAIL|n/a<TAB>status<TAB>seconds<TAB>toolcalls.
 *
 * Prints a table: task, ok, status, tool calls, model calls, tokens in/out, time (with a `run` column when repeating). With N > 1 it adds a per-task
 * `pass/N` table and a summary: pass@1 (mean single-run pass rate = passes / runs over scored tasks) and pass@N (share of scored tasks that passed
 * at least once); unchecked tasks (n/a) count in neither. Exits 1 when a task with a known answer fails (with N = 1) or never passes in any of the N
 * runs (with N > 1); a task that fails some runs but passes at least once does not fail the exit code, read pass@1 for that. State lives in
 * PISTA_HOME (or PI_CODING_AGENT_DIR) when you set it, else in a fresh temp dir deleted at the end; the suite never touches ~/.pista or copies
 * ~/.pi/agent, so model sign-ins must come from PISTA_HOME or an API key in the environment (NEBIUS_API_KEY). Sessions are in memory.
 *
 * Held-out set ×3 with tracing (llama-server on 127.0.0.1:8093, Chrome on 9222 as above):
 *   cd packages/pi-browser && npx tsx test/trace-proxy.ts --listen 8094 --target 8093 --out <dir>
 *   SUITE_SET=heldout SUITE_REPEAT=3 SUITE_TRACE=<dir> LLAMA_BASE_URL=http://127.0.0.1:8094 MODEL=llama.cpp/<id> pnpm eval:browser
 *   npx tsx test/trace-report.ts <dir>
 * Read pass@1 and pass@3 at the end of the suite output; trace-report.ts gives per-request cache and prefill numbers. Without a local model, drop
 * LLAMA_BASE_URL and set MODEL to a hosted provider; SUITE_TRACE then only writes tool-results.jsonl.
 */
import { tempHome } from "./suite-home.ts"; // first: points PISTA_HOME at a temp dir unless the caller chose one
import "../../../apps/host/src/pi-env.ts"; // side effects before any Pi code runs: sets PI_CODING_AGENT_DIR
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import type { ThinkingMode } from "@pista/protocol";
import { ModelRuntime, SessionManager, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { browserPrompt } from "../../../apps/host/src/extensions.ts";
import { browsingTurnsExtension } from "../../../apps/host/src/browsing-turns.ts";
import { listLocalModels, LLAMA_PROVIDER, LOCAL_CONTEXT, localPiModel, registerLocalProvider } from "../../../apps/host/src/local.ts";
import { registerNebiusProvider } from "../../../apps/host/src/nebius.ts";
import { buildSession } from "../../../apps/host/src/session.ts";
import { CdpDriver, registerBrowserTools } from "../src/index.ts";
import { HELDOUT_TASKS, type Task } from "./heldout-tasks.ts";

const FIXTURE_OK = (url: string) => /from=Stockholm/.test(url) && /to=Lisbon/.test(url) && /cabin=Business/.test(url) && /flex=on/.test(url);

// dac.dk venue pages on the URL pathname only (anchored, so /moedelokaler/foo does not pass); checked at load time below.
const DAC_ROOFTOP_PATH = /^\/(lokaler|moedelokaler\/(havneterrassen|byterrassen))\/?$/i;
if (!DAC_ROOFTOP_PATH.test("/lokaler") || DAC_ROOFTOP_PATH.test("/moedelokaler/foo")) throw new Error("dac-rooftop path pattern is wrong");

const TASKS: Task[] = [
  {
    name: "fixture-form",
    url: "http://127.0.0.1:8765/",
    goal: "Search flights from Stockholm to Lisbon in Business class with flexible dates.",
    report: "the query shown on the results page",
    inputs: { From: "Stockholm", To: "Lisbon", Cabin: "Business" },
    check: (_a, url) => FIXTURE_OK(url),
  },
  {
    // Same task without inputs: records what the model does when it has to find every value itself.
    name: "fixture-form-bare",
    url: "http://127.0.0.1:8765/",
    goal: "Search flights from Stockholm to Lisbon in Business class with flexible dates.",
    report: "the query shown on the results page",
    check: (_a, url) => FIXTURE_OK(url),
  },
  {
    name: "wikipedia-oresund",
    url: "https://en.wikipedia.org/wiki/Main_Page",
    goal: "Open the English Wikipedia article about the Øresund Bridge.",
    report: "the year the bridge opened",
    check: (a) => /2000/.test(a),
  },
  {
    name: "wikipedia-tyson",
    url: "https://www.wikipedia.org/",
    goal: "Search Wikipedia for Mike Tyson and open the article about the boxer.",
    report: "the years he competed as a professional boxer",
    check: (a) => /1985/.test(a),
  },
  {
    name: "books-category",
    url: "https://books.toscrape.com/",
    goal: "Open the Travel category, then open the book \"It's Only the Himalayas\".",
    report: "the book's price",
    check: (a) => /45\.17/.test(a),
  },
  {
    name: "restaurant-menu",
    url: "https://piccolomondolillatorg.se/",
    goal: "Open the restaurant's menu page.",
    report: "the price of the Insalata Mista",
    check: (a) => /109/.test(a),
  },
  {
    name: "google-flights",
    url: "https://www.google.com/travel/flights?hl=en",
    goal: "Search for round-trip flights from Copenhagen to Barcelona, departing 23 October 2026 and returning 30 October 2026, and show the results.",
    report: "the cheapest flight shown: price, airline and times",
    check: (a) => /\d/.test(a) && !/not (shown|contain|available)/i.test(a),
  },
  {
    // The request after the chat model picked concrete dates itself, keeping "(CPH)"-style values.
    name: "google-flights-chosen-dates",
    url: "https://www.google.com/travel/flights?hl=en",
    goal: "Search for the cheapest round-trip economy flight for 1 adult from Copenhagen (CPH) to Barcelona (BCN), departing 2026-10-24 and returning 2026-10-31. Do not book anything.",
    report: "Cheapest available round-trip option, with dates, airline, stops and price.",
    inputs: { From: "Copenhagen (CPH)", To: "Barcelona (BCN)", Departure: "2026-10-24", Return: "2026-10-31" },
    check: (a) => /SEK|kr|€|\$/.test(a) && /\d{3}/.test(a),
  },
  {
    // dac.dk books the rooftop through an inquiry form on the venue page, not a booking URL, so the venue pages count.
    name: "dac-rooftop",
    url: "https://dac.dk",
    goal: "Find whether DAC's rooftop has a booking page and open it",
    report: "whether a rooftop booking page exists and its URL",
    check: (_a, url) => {
      try {
        return DAC_ROOFTOP_PATH.test(new URL(url).pathname);
      } catch {
        return false;
      }
    },
  },
  {
    name: "aak-job",
    unchecked: "no known answer; read the answer in the log",
    url: "https://www.aak.com",
    goal: "Find the AAK job posting titled 'AI Capability Lead' and the contact person named on it",
    report: "the contact person named on the posting",
    check: () => true,
  },
];

const BROWSER_TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_read",
  "browser_click",
  "browser_type",
  "browser_select",
  "browser_press",
  "browser_scroll",
  "browser_back",
  "browser_screenshot",
  "browser_eval",
  // Offered to the model only when their flag registers them (fill unless PI_BROWSER_FILL=0, choose only with PI_BROWSER_CHOOSE=1).
  ...(process.env.PI_BROWSER_CHOOSE === "1" ? ["browser_choose"] : []),
  ...(process.env.PI_BROWSER_FILL !== "0" ? ["browser_fill"] : []),
];

function prompt(task: Task): string {
  const values = task.inputs ? ` Values to use: ${Object.entries(task.inputs).map(([k, v]) => `${k} = ${v}`).join("; ")}.` : "";
  return `${task.goal} Start at ${task.url}.${values}${task.report ? ` When you are done, tell me ${task.report}.` : ""}`;
}

/** Serves test/fixture on 127.0.0.1:8765 unless that port is taken (then whatever listens there is used). */
async function serveFixtures(): Promise<Server | undefined> {
  const root = join(import.meta.dirname, "fixture");
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
  const server = createServer((req, res) => {
    const path = normalize(new URL(req.url ?? "/", "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
    try {
      const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.once("error", () => resolve(undefined));
    server.listen(8765, "127.0.0.1", () => resolve(server));
  });
}

// Split on the first slash only: model ids can contain slashes.
const spec = process.env.MODEL ?? "openai-codex/gpt-6-luna";
const slash = spec.indexOf("/");
if (slash < 1) throw new Error(`MODEL must look like <provider>/<model id>, got "${spec}"`);
const provider = spec.slice(0, slash);
const modelId = spec.slice(slash + 1);

const runtime = await ModelRuntime.create({ allowModelNetwork: true });
registerNebiusProvider(runtime);
const llamaUrl = process.env.LLAMA_BASE_URL?.replace(/\/+$/, "").replace(/\/v1$/, "");
if (llamaUrl) {
  const contextWindow = Number(process.env.LLAMA_CONTEXT ?? LOCAL_CONTEXT);
  const models = async () => (await listLocalModels("llamacpp", llamaUrl)).map((m) => localPiModel({ id: m.id, name: m.name ?? m.id, contextWindow: Number(process.env.LLAMA_CONTEXT ?? m.contextWindow ?? contextWindow), vision: m.vision, thinkingOptions: ["off"] }));
  registerLocalProvider(runtime, LLAMA_PROVIDER, { name: "llama.cpp", baseUrl: llamaUrl, models: await models(), refreshModels: models });
}
if (!runtime.getModel(provider, modelId)) throw new Error(`Model ${provider}/${modelId} not found`);

const fixtureServer = await serveFixtures();
const driver = new CdpDriver(process.env.PI_BROWSER_CDP_URL);
const browser: InlineExtension = { name: "browser", factory: (pi) => registerBrowserTools(pi, () => driver) };
// Wired like children.ts wires it for a thread in "auto" thinking mode; an explicit THINKING level, like the user's choice in the app, stands.
const browsingTurns = browsingTurnsExtension({ config: { localServers: [] }, thinkingMode: () => (process.env.THINKING as ThinkingMode | undefined) ?? "auto" });
const timeoutMs = Number(process.env.TASK_TIMEOUT_S ?? 300) * 1000;

// `--repeat N` / `--repeat=N` is a flag, not a task name; everything else on the command line is.
let repeatArg: string | undefined;
const positional: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (arg === "--repeat") repeatArg = process.argv[++i];
  else if (arg.startsWith("--repeat=")) repeatArg = arg.slice("--repeat=".length);
  else positional.push(arg);
}
const repeat = Number(repeatArg ?? process.env.SUITE_REPEAT ?? 1);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`--repeat / SUITE_REPEAT must be a positive integer, got "${repeatArg ?? process.env.SUITE_REPEAT}"`);
const only = [...positional, ...(process.env.SUITE_TASKS?.split(",").filter(Boolean) ?? [])];
const setName = process.env.SUITE_SET ?? "default";
const pool = { default: TASKS, heldout: HELDOUT_TASKS, all: [...TASKS, ...HELDOUT_TASKS] }[setName];
if (!pool) throw new Error(`SUITE_SET must be default, heldout or all, got "${setName}"`);
const unknown = only.filter((name) => !pool.some((t) => t.name === name));
if (unknown.length) console.log(`Not in set "${setName}" (ignored): ${unknown.join(", ")}`);
const selected = pool.filter((t) => !only.length || only.includes(t.name));

// SUITE_TRACE=<dir> (off by default): labels each run for trace-proxy.ts (<dir>/label.json) and logs every tool result as the harness produced it
// (<dir>/tool-results.jsonl, truncated at each suite start). Point LLAMA_BASE_URL at the proxy to capture the model side; see trace-proxy.ts and
// trace-report.ts. Trace files hold full page text and tool output: keep them out of shared places.
const traceDir = process.env.SUITE_TRACE;
if (traceDir) {
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "tool-results.jsonl"), ""); // each suite start replaces the previous log in this dir
}

type Block = { type: string; text?: string };
type Message = { role: string; content?: string | Block[]; stopReason?: string; errorMessage?: string; usage?: { input: number; output: number } };
const textOf = (m: Message | undefined) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n"));

const rows: string[][] = [];
/** Per task: runs and passes (scored tasks only; unchecked ones have no verdict). */
const tally = new Map<string, { runs: number; passes: number; scored: boolean }>();
const runs = selected.flatMap((task) => Array.from({ length: repeat }, (_, i) => ({ task, run: i + 1 })));
for (const { task, run } of runs) {
  if (traceDir) writeFileSync(join(traceDir, "label.json"), JSON.stringify({ task: task.name, run }));
  console.log(`\n=== ${task.name}${repeat > 1 ? ` (run ${run}/${repeat})` : ""}: ${task.goal}`);
  const cwd = mkdtempSync(join(tmpdir(), "pi-browser-eval-"));
  const session = await buildSession({
    cwd,
    models: runtime,
    model: { provider, id: modelId },
    sessionManager: SessionManager.inMemory(cwd),
    tools: BROWSER_TOOLS,
    extensionFactories: [browser, browsingTurns],
    appendSystemPrompt: [[...browserPrompt("https://duckduckgo.com/", false), "Nobody is available to answer questions: the user's message is all the instruction you get. When you are done, answer in a few sentences."].join("\n")],
    isLocal: (m) => m.provider === LLAMA_PROVIDER,
  });
  if (process.env.THINKING) session.setThinkingLevel(process.env.THINKING as never);

  let settle!: () => void;
  const settled = new Promise<void>((r) => (settle = r));
  session.subscribe((event) => {
    if (event.type === "agent_settled") settle();
    if (traceDir && event.type === "tool_execution_end") {
      const parts = ((event.result as { content?: { type: string; text?: string }[] } | undefined)?.content ?? []).map((b) => (b.type === "text" ? b.text ?? "" : `[${b.type}]`));
      appendFileSync(join(traceDir, "tool-results.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), task: task.name, run, toolCallId: event.toolCallId, tool: event.toolName, isError: event.isError, chars: parts.join("").length, text: parts })}\n`);
    }
    if (event.type === "tool_execution_start") console.log(`  ${event.toolName} ${JSON.stringify(event.args).slice(0, 120)}`);
  });
  const t0 = performance.now();
  let status = "answered";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await driver.navigate("about:blank").catch(() => {});
    const run = (async () => {
      await session.prompt(prompt(task));
      await settled;
    })();
    const outcome = await Promise.race([run.then(() => "ok" as const), new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), timeoutMs)))]);
    if (outcome === "timeout") {
      status = "timeout";
      await session.abort().catch(() => {});
    }
  } catch (error) {
    status = "error";
    console.log(`  ! ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const seconds = Math.round((performance.now() - t0) / 100) / 10;

  const messages = session.messages as unknown as Message[];
  const assistant = messages.filter((m) => m.role === "assistant");
  const last = assistant.at(-1);
  if (status === "answered" && last?.stopReason && last.stopReason !== "stop") status = last.stopReason;
  const answer = textOf(last);
  const url = await driver.state().then((s) => s.url, () => "");
  const toolCalls = messages.filter((m) => m.role === "toolResult").length;
  const tokensIn = assistant.reduce((n, m) => n + (m.usage?.input ?? 0), 0);
  const tokensOut = assistant.reduce((n, m) => n + (m.usage?.output ?? 0), 0);
  const pass = status === "answered" && task.check(answer, url);
  console.log(`  → ${status} ${task.unchecked ? "n/a" : pass ? "PASS" : "FAIL"} ${url}: ${answer.replace(/\s+/g, " ").slice(0, 200)}`);
  const verdict = task.unchecked ? "n/a" : pass ? "PASS" : "FAIL";
  console.log(`RESULT\t${task.name}\t${run}\t${verdict}\t${status}\t${seconds}\t${toolCalls}`);
  const t = tally.get(task.name) ?? { runs: 0, passes: 0, scored: !task.unchecked };
  t.runs++;
  if (pass && !task.unchecked) t.passes++;
  tally.set(task.name, t);
  rows.push([task.name, ...(repeat > 1 ? [String(run)] : []), verdict, status, String(toolCalls), String(assistant.length), `${tokensIn}/${tokensOut}`, `${seconds}s`]);
  session.dispose();
  rmSync(cwd, { recursive: true, force: true });
}

function printTable(header: string[], body: string[][]) {
  const widths = header.map((h, c) => Math.max(h.length, ...body.map((r) => r[c]!.length)));
  const line = (r: string[]) => r.map((cell, c) => cell.padEnd(widths[c]!)).join("  ").trimEnd();
  console.log(`\n${line(header)}`);
  for (const r of body) console.log(line(r));
}
printTable(["task", ...(repeat > 1 ? ["run"] : []), "ok", "status", "tool calls", "model calls", "tokens in/out", "time"], rows);

let neverPassed = false;
if (repeat > 1) {
  printTable(["task", `pass/${repeat}`], [...tally].map(([name, t]) => [name, t.scored ? `${t.passes}/${t.runs}` : "n/a"]));
  const scored = [...tally.values()].filter((t) => t.scored);
  const totalRuns = scored.reduce((n, t) => n + t.runs, 0);
  const totalPasses = scored.reduce((n, t) => n + t.passes, 0);
  const anyPass = scored.filter((t) => t.passes > 0).length;
  neverPassed = anyPass < scored.length;
  if (scored.length) console.log(`\nscored tasks: ${scored.length}, runs: ${totalRuns}, pass@1: ${(totalPasses / totalRuns).toFixed(3)} (${totalPasses}/${totalRuns}), pass@${repeat}: ${(anyPass / scored.length).toFixed(3)} (${anyPass}/${scored.length})`);
}
fixtureServer?.close();
if (tempHome) rmSync(tempHome, { recursive: true, force: true });
// N = 1: any FAIL. N > 1: only a scored task that never passed in any run.
process.exit((repeat > 1 ? neverPassed : rows.some((r) => r.includes("FAIL"))) ? 1 : 0);
