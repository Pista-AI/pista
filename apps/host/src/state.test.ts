import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { fauxModels, setupHome } from "./test-helpers.ts";

// Not `after()`: the tests below are registered after top-level awaits, so a root hook would fire early.
const { root: tmp, agentDir } = setupHome("state-test", { cleanup: "exit" });
// Make compaction cut early so a handful of short turns leaves something to summarise.
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));

const { buildStateSection, readStateFiles, stateExtension, TRUNCATION_MARKER } = await import("./state.ts");

// -- buildStateSection ---------------------------------------------------------------------------

test("buildStateSection is undefined when no file has content", () => {
  assert.equal(buildStateSection({}), undefined);
  assert.equal(buildStateSection({ plan: "  \n", status: "" }), undefined);
});

test("buildStateSection orders STATUS, PLAN, PROGRESS and fits small files whole", () => {
  const section = buildStateSection({ plan: "1. a\n2. b", progress: "did a", status: "on step 2" })!;
  assert.ok(section.indexOf("STATUS") < section.indexOf("PLAN"));
  assert.ok(section.indexOf("PLAN") < section.indexOf("PROGRESS"));
  for (const text of ["1. a\n2. b", "did a", "on step 2"]) assert.ok(section.includes(text));
  assert.ok(!section.includes(TRUNCATION_MARKER));
});

test("buildStateSection with one file includes only that file", () => {
  const section = buildStateSection({ progress: "log" })!;
  assert.ok(section.includes("PROGRESS") && !section.includes("PLAN") && !section.includes("STATUS"));
});

test("buildStateSection never exceeds the cap and truncates from the top with a marker", () => {
  const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} line ${i}`).join("\n");
  const files = { plan: lines(400, "plan"), progress: lines(2000, "progress"), status: "status line" };
  for (const cap of [300, 1000, 8000]) {
    const section = buildStateSection(files, cap)!;
    assert.ok(section.length <= cap, `length ${section.length} > cap ${cap}`);
  }
  const section = buildStateSection(files, 2000)!;
  assert.ok(section.includes(TRUNCATION_MARKER));
  assert.ok(section.includes("progress line 1999"), "newest progress kept");
  assert.ok(!section.includes("progress line 0\n"), "oldest progress dropped");
  assert.ok(section.includes("plan line 399"));
  assert.ok(section.includes("PLAN") && section.includes("PROGRESS"), "plan does not starve progress");
});

test("buildStateSection keeps STATUS whole while PLAN and PROGRESS are truncated", () => {
  const status = Array.from({ length: 30 }, (_, i) => `status ${i}`).join("\n");
  const big = "x".repeat(100) + "\n";
  const section = buildStateSection({ status, plan: big.repeat(100), progress: big.repeat(100) }, 1500)!;
  assert.ok(section.includes(status));
  assert.ok(section.length <= 1500);
  assert.equal(section.split(TRUNCATION_MARKER).length - 1, 2);
});

test("buildStateSection truncates STATUS itself only when it alone exceeds the cap", () => {
  const status = Array.from({ length: 500 }, (_, i) => `status ${i}`).join("\n");
  const section = buildStateSection({ status }, 500)!;
  assert.ok(section.length <= 500);
  assert.ok(section.includes(TRUNCATION_MARKER) && section.includes("status 499"));
});

// -- harness: real session, faux model, stubbed compaction ---------------------------------------

const { ModelRuntime, SessionManager } = await import("@earendil-works/pi-coding-agent");
const { buildSession } = await import("./session.ts");
const { ConfigStore } = await import("./config.ts");
const { systemPrompt } = await import("./extensions.ts");

async function harness(options: { cwd?: string; sessionManager?: ReturnType<typeof SessionManager.inMemory>; stubCompaction?: boolean } = {}) {
  const cwd = options.cwd ?? mkdtempSync(join(tmp, "ws-"));
  mkdirSync(join(cwd, ".pista"), { recursive: true });
  writeFileSync(join(cwd, "AGENTS.md"), "PROJECT-RULE-XYZ: always run the tests.");
  writeFileSync(join(cwd, ".pista/STATUS.md"), "STATUS-MARK step 2 of 5");
  writeFileSync(join(cwd, ".pista/PLAN.md"), "1. [x] a\n2. [ ] b");

  const runtime = await ModelRuntime.create({ authPath: join(tmp, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const { piAi, faux, models, ref } = await fauxModels(runtime);
  faux.setResponses(Array.from({ length: 12 }, (_, i) => piAi.fauxAssistantMessage(`reply ${i}`)));
  const model = faux.getModel();

  const stub: InlineExtension = {
    name: "stub-compaction",
    factory: (pi) => {
      // Supplying the summary means no model is called for compaction.
      pi.on("session_before_compact", (event) => ({
        compaction: {
          summary: "STUB-SUMMARY",
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
        },
      }));
    },
  };
  const session = await buildSession({
    cwd,
    models,
    model: ref,
    ...(options.sessionManager ? { sessionManager: options.sessionManager } : { sessionManager: SessionManager.inMemory(cwd) }),
    appendSystemPrompt: [systemPrompt(new ConfigStore())],
    extensionFactories: [stateExtension(), ...(options.stubCompaction === false ? [] : [stub])],
  });
  await session.setModel(model);
  await session.bindExtensions({});
  return { cwd, session };
}

type Sectioned = { role: string; sections?: Record<string, string | null> };
const systemMessages = (messages: readonly unknown[]) => (messages as Sectioned[]).filter((m) => m.role === "system");

test("compaction keeps the Pista addendum, project context and pista_state in the leading system message", async () => {
  const { cwd, session } = await harness();
  for (const text of ["first question", "second question", "third question"]) await session.prompt(text);

  await session.compact();

  const messages = session.messages as Sectioned[];
  const lead = messages[0]!;
  assert.equal(lead.role, "system");
  assert.ok(lead.sections?.addendum?.includes("You are running inside Pista"), "Pista addendum");
  assert.ok(lead.sections?.addendum?.includes("PLAN.md"), "state convention in the addendum");
  assert.ok(lead.sections?.project_context?.includes("PROJECT-RULE-XYZ"), "AGENTS.md project context");
  assert.ok(lead.sections?.pista_state?.includes("STATUS-MARK step 2 of 5"), "pista_state section");
  assert.ok(lead.sections?.pista_state?.includes("2. [ ] b"));
  assert.ok(JSON.stringify(messages).includes("STUB-SUMMARY"), "stub summary used, not a model call");
  assert.equal(messages.filter((m) => m.role === "system").length, 1, "no stale system messages left behind");

  // After compaction the next prompt picks up edits made to the files.
  writeFileSync(join(cwd, ".pista/STATUS.md"), "STATUS-MARK step 3 of 5");
  await session.prompt("after compaction");
  const patches = systemMessages(session.messages).slice(1);
  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0]!.sections!), ["pista_state"]);
  assert.ok(patches[0]!.sections!.pista_state!.includes("step 3 of 5"));
});

test("an unchanged state section appends no system message; a changed one patches only that section", async () => {
  const { cwd, session } = await harness({ stubCompaction: false });
  await session.prompt("one");
  await session.prompt("two");
  assert.equal(systemMessages(session.messages).length, 1, "unchanged state: no new system message");
  assert.ok(systemMessages(session.messages)[0]!.sections!.pista_state!.includes("step 2 of 5"), "section stays set");

  writeFileSync(join(cwd, ".pista/STATUS.md"), "STATUS-MARK step 4 of 5");
  await session.prompt("three");
  const sys = systemMessages(session.messages);
  assert.equal(sys.length, 2);
  assert.deepEqual(Object.keys(sys[1]!.sections!), ["pista_state"]);

  rmSync(join(cwd, ".pista"), { recursive: true });
  await session.prompt("four");
  const last = systemMessages(session.messages).at(-1)!;
  assert.deepEqual(last.sections, { pista_state: null }, "removing the files removes the section");
});

test("a compaction entry without systemMessage (older sessions) is repaired by the next prompt", async () => {
  const cwd = mkdtempSync(join(tmp, "old-"));
  const sm = SessionManager.inMemory(cwd);
  sm.appendMessage({ role: "user", content: [{ type: "text", text: "old question" }], timestamp: 1 });
  const keptId = sm.appendMessage({ role: "user", content: [{ type: "text", text: "kept question" }], timestamp: 2 });
  sm.appendCompaction("OLD-SUMMARY", keptId, 1000);
  const entry = sm.getEntries().at(-1) as { type: string; systemMessage?: unknown };
  assert.equal(entry.type, "compaction");
  assert.equal(entry.systemMessage, undefined, "fixture has no stored system message");

  const { session } = await harness({ cwd, sessionManager: sm, stubCompaction: false });
  assert.equal(systemMessages(session.messages).length, 0);
  await session.prompt("resume");
  const lead = systemMessages(session.messages)[0]!;
  assert.ok(lead.sections?.addendum?.includes("You are running inside Pista"));
  assert.ok(lead.sections?.project_context?.includes("PROJECT-RULE-XYZ"));
  assert.ok(lead.sections?.pista_state?.includes("STATUS-MARK"));
});

test("readStateFiles reads the three files and ignores missing ones", () => {
  const cwd = mkdtempSync(join(tmp, "read-"));
  mkdirSync(join(cwd, ".pista"));
  writeFileSync(join(cwd, ".pista/PLAN.md"), "p");
  assert.deepEqual(readStateFiles(cwd), { plan: "p" });
});

test("readStateFiles reads only the tail of a file over 256 KB", () => {
  const cwd = mkdtempSync(join(tmp, "big-"));
  mkdirSync(join(cwd, ".pista"));
  const line = (i: number) => `entry ${String(i).padStart(6, "0")} ${"x".repeat(40)}\n`;
  const text = Array.from({ length: 6000 }, (_, i) => line(i)).join("");
  assert.ok(text.length > 300 * 1024);
  writeFileSync(join(cwd, ".pista/PROGRESS.md"), text);
  const progress = readStateFiles(cwd).progress!;
  assert.ok(progress.length <= 32 * 1024);
  assert.ok(progress.endsWith(line(5999)), "newest entries kept");
  assert.ok(!progress.includes("entry 000000"), "oldest entries dropped");
  assert.ok(progress.startsWith("entry "), "starts on a line boundary");
});
