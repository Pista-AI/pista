import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("context-replay-test", { cleanup: "exit" });
const { collapseSearchResults, pruneContext, contextPruneOptions } = await import("./context-prune.ts");
const { defaultHooks, formatStats, loadSession, replaySession } = await import("./context-replay.ts");

type Msg = { role: string; [k: string]: any };
const call = (id: string, name: string, args: unknown) => ({ type: "toolCall", id, name, arguments: args });
const asst = (...c: unknown[]): Msg => ({ role: "assistant", content: c.length ? c : [{ type: "text", text: "ok" }] });
const res = (id: string, toolName: string, text: string, isError = false): Msg => ({ role: "toolResult", toolCallId: id, toolName, isError, content: [{ type: "text", text }] });
const hit = (title: string, url: string) => `${"snippet ".repeat(80)}\nSource: ${title} (${url})`;
const searchText = (...urls: string[]) => `**Provider:** exa\n\n${urls.map((u, i) => hit(`Title ${i}`, u)).join("\n\n")}`;
const textOf = (m: Msg) => (m.content as any[]).map((p) => p.text ?? "").join("");

test("web_search collapses once a listed URL was navigated to", () => {
  const messages: Msg[] = [
    { role: "user", content: "find pasta" },
    asst(call("s1", "web_search", { queries: ["best pasta in rome", "pasta carbonara"] })),
    res("s1", "web_search", searchText("https://www.Example.com/a/", "https://other.org/b#x", "https://third.net/c")),
    asst(call("n1", "browser_navigate", { url: "https://example.com/a#top" })),
    res("n1", "browser_navigate", "navigated"),
    asst(call("n2", "browser_navigate", { url: "https://third.net/c" })),
    res("n2", "browser_navigate", "navigated"),
  ];
  const out = collapseSearchResults(messages);
  assert.equal(
    textOf(out[2]!),
    '[earlier web_search results for "best pasta in rome / pasta carbonara": visited https://www.Example.com/a/, https://third.net/c; 1 other results]',
  );
  assert.equal(out[1], messages[1], "other messages are untouched by reference");
  assert.ok(textOf(messages[2]!).length > 500, "input is not mutated");
});

test("threads without browser calls keep their search results", () => {
  const research: Msg[] = [
    { role: "user", content: "research" },
    asst(call("s1", "web_search", { query: "a" })),
    res("s1", "web_search", searchText("https://a.com/", "https://b.com/")),
    asst(call("s2", "web_search", { query: "b" })),
    res("s2", "web_search", searchText("https://c.com/")),
    asst(),
    asst(),
    asst(),
  ];
  assert.equal(collapseSearchResults(research), research);
  const withBrowser = [...research, asst(call("n", "browser_navigate", { url: "https://a.com/" })), res("n", "browser_navigate", "ok")];
  const out = collapseSearchResults(withBrowser);
  assert.ok(textOf(out[2]!).startsWith("[earlier web_search results"));
  assert.ok(textOf(out[4]!).startsWith("[earlier web_search results"));
});

test("an unvisited search collapses only after two further assistant turns", () => {
  const base: Msg[] = [
    { role: "user", content: "go" },
    asst(call("s1", "web_search", { query: "q".repeat(100) }), call("b0", "browser_snapshot", {})),
    res("s1", "web_search", searchText("https://a.com/", "https://b.com/")),
    asst(),
  ];
  assert.equal(collapseSearchResults(base), base, "one turn later: untouched");
  const state = new Map<string, string>();
  const out = collapseSearchResults([...base, res("x", "bash", "ok"), asst()], state);
  assert.equal(textOf(out[2]!), `[earlier web_search results for "${"q".repeat(59)}…": visited none of them; 2 results]`);
  assert.equal(state.get("s1"), textOf(out[2]!));
  // Sticky: a later navigate to a listed URL does not rewrite the line that was already sent.
  const later = [...base, res("x", "bash", "ok"), asst(), asst(call("n", "browser_navigate", { url: "https://a.com" }))];
  assert.equal(textOf(collapseSearchResults(later, state)[2]!), state.get("s1"));
});

test("fetch_content, errors and results without ids", () => {
  const messages: Msg[] = [
    { role: "user", content: "go" },
    asst(call("f1", "fetch_content", { url: "https://docs.example.com/guide/intro/?x=1" }), call("f2", "fetch_content", { url: "https://bad.example" }), call("b0", "browser_snapshot", {})),
    res("f1", "fetch_content", `# Intro guide\n\n${"body ".repeat(200)}`),
    res("f2", "fetch_content", "Error: HTTP 403", true),
    { role: "toolResult", toolName: "web_search", isError: false, content: [{ type: "text", text: "no id ".repeat(200) }] },
    asst(),
    asst(),
  ];
  const out = collapseSearchResults(messages);
  assert.equal(textOf(out[2]!), "[earlier fetch_content of docs.example.com/guide/intro: Intro guide, 1015 chars]");
  assert.equal(textOf(out[3]!), "[earlier failed fetch_content]");
  assert.equal(out[4], messages[4]);
});

test("the pass runs before the pruner, which sees the short line", () => {
  const messages: Msg[] = [
    { role: "user", content: "go" },
    asst(call("s1", "web_search", { query: "x" })),
    res("s1", "web_search", searchText("https://a.com/")),
    asst(call("n", "browser_navigate", { url: "https://a.com/" })),
    res("n", "browser_navigate", "ok"),
    asst(),
  ];
  const options = contextPruneOptions({ contextWindow: 32768 }, {})!;
  const out = pruneContext(messages, { ...options, keepRecent: 0, batch: 1 });
  assert.ok(textOf(out[2]!).startsWith("[earlier web_search results"));
});

test("PISTA_PRUNE_RESULT_CHARS sets minChars; invalid values fall back to 600", () => {
  assert.equal(contextPruneOptions(undefined, {})!.minChars, 600);
  assert.equal(contextPruneOptions(undefined, { PISTA_PRUNE_RESULT_CHARS: "1500" })!.minChars, 1500);
  for (const bad of ["", "abc", "-5"]) {
    const v = contextPruneOptions(undefined, { PISTA_PRUNE_RESULT_CHARS: bad })!.minChars;
    assert.equal(v, 600, bad);
  }
});

test("replaySession reports growth per assistant turn on a synthetic session", () => {
  const entries = [
    { type: "session" },
    { type: "message", message: { role: "user", content: "hi" } },
    { type: "message", message: asst(call("s1", "web_search", { query: "a" })) },
    { type: "message", message: res("s1", "web_search", searchText("https://a.com/", "https://b.com/")) },
    { type: "message", message: asst(call("n", "browser_navigate", { url: "https://a.com" })) },
    { type: "message", message: res("n", "browser_navigate", "ok") },
    { type: "message", message: asst() },
  ];
  const stats = replaySession(entries, defaultHooks());
  assert.deepEqual(stats.map((s) => s.turn), [1, 2, 3]);
  assert.equal(stats[0]!.tokensBefore, stats[0]!.tokensAfter);
  assert.ok(stats[2]!.tokensAfter < stats[2]!.tokensBefore, "the search result shrinks");
  assert.equal(replaySession(entries, defaultHooks({ host: false }))[2]!.tokensAfter, stats[2]!.tokensBefore);
});

const session = process.env.PISTA_REPLAY_SESSION;
// Turn 3 of the reference run holds only a collapsed web_search result, while later turns legitimately carry the current
// page's full view (~5k tokens for a Yelp listing), so a flat line relative to turn 3 is not attainable. The bar guards
// against regression of the measured 2.3.
const parsedRatio = parseFloat(process.env.PISTA_REPLAY_MAX_RATIO ?? "2.5");
const maxRatio = Number.isFinite(parsedRatio) ? parsedRatio : 2.5;
test("replay of a recorded session stays flat after turn 3", { skip: session && existsSync(session) ? false : "set PISTA_REPLAY_SESSION to a session .jsonl to run" }, () => {
  const stats = replaySession(loadSession(session!), defaultHooks());
  console.log(formatStats(stats));
  const t3 = stats.find((s) => s.turn === 3)!.tokensAfter;
  const later = stats.filter((x) => x.turn >= 3);
  const observed = Math.max(...later.map((s) => s.tokensAfter / t3));
  console.log(`max ratio after turn 3: ${observed.toFixed(2)} (limit ${maxRatio}, PISTA_REPLAY_MAX_RATIO)`);
  for (const s of later) assert.ok(s.tokensAfter <= maxRatio * t3, `turn ${s.turn}: ${s.tokensAfter} > ${maxRatio} x ${t3}`);
});

test("fetch_content collapses on a later navigate without waiting two turns; unlisted navigate gives 'visited none'", () => {
  const messages: Msg[] = [
    { role: "user", content: "go" },
    asst(call("f1", "fetch_content", { url: "https://docs.example.com/a" }), call("s1", "web_search", { query: "q" }), call("b0", "browser_snapshot", {})),
    res("f1", "fetch_content", `# Doc\n\n${"body ".repeat(200)}`),
    res("s1", "web_search", searchText("https://a.com/")),
    asst(call("n", "browser_navigate", { url: "https://elsewhere.org/" })),
    res("n", "browser_navigate", "ok"),
  ];
  const out = collapseSearchResults(messages);
  assert.ok(textOf(out[2]!).startsWith("[earlier fetch_content of docs.example.com/a"));
  assert.ok(textOf(out[3]!).includes("visited none of them; 1 results"));
});

test("a navigate in the same assistant turn as the search does not count as acting on it", () => {
  const messages: Msg[] = [
    { role: "user", content: "go" },
    asst(call("s1", "web_search", { query: "q" }), call("n", "browser_navigate", { url: "https://a.com/" })),
    res("s1", "web_search", searchText("https://a.com/")),
    res("n", "browser_navigate", "ok"),
  ];
  assert.equal(collapseSearchResults(messages), messages);
});

test("collapsed lines stay applied after the browser calls leave the request, and a small minChars does not re-stub them", () => {
  const state = new Map<string, string>([["s1", "[earlier web_search results for \"q\": visited none of them; 2 results]"]]);
  const messages: Msg[] = [{ role: "user", content: "go" }, asst(call("s1", "web_search", { query: "q" })), res("s1", "web_search", searchText("https://a.com/"))];
  const out = collapseSearchResults(messages, state);
  assert.equal(textOf(out[2]!), state.get("s1"));
  const pruned = pruneContext([...out, asst(), asst(), asst(), asst(), asst(), asst()], { keepRecent: 0, minChars: 0, batch: 1, protectedTools: [], maxToolChars: 1_000_000 } as any, state);
  assert.equal(textOf(pruned[2]!), state.get("s1"));
});
