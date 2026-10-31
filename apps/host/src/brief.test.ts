import assert from "node:assert/strict";
import test from "node:test";
import { briefProblem, capReport, composeBrief, hasReportSections, looksLikeCode, reportSections } from "./brief.ts";

test("looksLikeCode flags fenced blocks and runs of code lines", () => {
  assert.equal(looksLikeCode("Do this:\n```ts\nfoo()\n```"), true);
  assert.equal(looksLikeCode('import a from "a";\nexport const b = 1;\nreturn b;'), true);
  assert.equal(looksLikeCode("if (x) {\n  y();\n}\n"), true);
});

test("looksLikeCode accepts prose, backticked names and up to 2 code-like lines", () => {
  assert.equal(looksLikeCode("Make `parseConfig` accept an empty file and return defaults."), false);
  assert.equal(looksLikeCode("Reuse `clip` from text.ts.\nKeep the `export` shape."), false);
  assert.equal(looksLikeCode("const a = 1;\nconst b = 2;"), false);
  assert.equal(looksLikeCode(undefined), false);
});

test("briefProblem checks goal and constraints only", () => {
  assert.match(briefProblem({ goal: "```x```" }) ?? "", /Remove the code/);
  assert.match(briefProblem({ goal: "fine", constraints: "a;\nb;\nc;" }) ?? "", /Remove the code/);
  assert.equal(briefProblem({ goal: "fine", constraints: "do not touch ui" }), undefined);
});

test("composeBrief lays out the sections and the standing line", () => {
  const out = composeBrief({ goal: "Add X.", pointers: ["src/a.ts", "fn b"], acceptance: "pnpm test", constraints: "no ui" });
  const heads = out.split("\n\n").map((p) => p.split("\n")[0]);
  assert.deepEqual(heads.slice(0, 4), ["## Goal", "## Start from", "## Acceptance", "## Constraints"]);
  assert.match(heads[4]!, /^Read the code before deciding details; follow the conventions of neighbouring code;/);
  assert.ok(out.includes("- src/a.ts\n- fn b"));
  assert.ok(!composeBrief({ goal: "Add X." }).includes("## Acceptance"));
});

test("composeBrief for a follow-up is the goal text without headings or standing line", () => {
  assert.equal(composeBrief({ goal: "And the tests?" }, true), "And the tests?");
});

test("hasReportSections depends on the role", () => {
  const impl = "## Changed\nnone\n## Ran\nx\n## Assumptions\nnone\n## Open questions\nnone";
  assert.equal(hasReportSections(impl, "implementer"), true);
  assert.equal(hasReportSections(impl, "explorer"), false);
  assert.equal(hasReportSections(impl.replace("Changed", "Findings"), "reviewer"), true);
  assert.equal(hasReportSections("just prose", "implementer"), false);
  assert.equal(reportSections("explorer")[0], "## Findings");
});

test("capReport truncates with a marker", () => {
  assert.equal(capReport("short"), "short");
  const out = capReport("x".repeat(7000));
  assert.ok(out.endsWith("\n[truncated]"));
  assert.equal(out.length, 6000 + "\n[truncated]".length);
});

test("looksLikeCode negatives: backticked identifier, commands and file:line references", () => {
  assert.equal(looksLikeCode("Use `clip` from text.ts"), false);
  assert.equal(looksLikeCode("Run node --test and pnpm typecheck"), false);
  assert.equal(looksLikeCode("Start from src/x.ts:42\napps/host/src/y.ts:7"), false);
});

test("briefProblem checks pointers but not acceptance", () => {
  assert.match(briefProblem({ goal: "ok", pointers: ["a;", "b;", "c;"] }) ?? "", /Remove the code/);
});

test("hasReportSections accepts colon and bold variants", () => {
  const r = "**Changed**\nx\n## Ran:\nx\n## **Assumptions**\nx\n**Open questions:**\nx";
  assert.equal(hasReportSections(r, "implementer"), true);
});

test("capReport keeps the first line and the closing sections, trimming the body", () => {
  const report = `Summary line\n## Changed\n${"c".repeat(5000)}\n## Ran\n${"r".repeat(5000)}\n## Assumptions\nA1\n## Open questions\nQ1`;
  const out = capReport(report);
  assert.ok(out.length <= 6000);
  assert.ok(out.startsWith("Summary line\n## Changed"));
  assert.ok(out.endsWith("## Assumptions\nA1\n## Open questions\nQ1"));
  assert.ok(out.includes("[truncated]"));
});

test("capReport does not split a surrogate pair", () => {
  const out = capReport("😀".repeat(100), 51);
  assert.ok(!/[\ud800-\udbff]\n\[truncated\]$/.test(out));
});
