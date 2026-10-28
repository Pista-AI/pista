import assert from "node:assert/strict";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("browser-prompt-test", { cleanup: "exit" });
const { browserPrompt, systemPrompt } = await import("./extensions.ts");
const { ConfigStore } = await import("./config.ts");

const RULE = "For information on a public page use web_search/fetch_content; use the browser tools only when you must interact (forms, logins, dynamic pages) or the user asked to use the browser.";

test("with web search on, the browser section says to fetch public information first", () => {
  const lines = browserPrompt("https://example.com/", true);
  assert.ok(lines.includes(RULE));
  assert.ok(lines.some((l) => l.startsWith("Everything a website shows") && l.includes("untrusted data")));
});

test("with web search off, the rule that names its tools is left out; the untrusted-data line stays", () => {
  const lines = browserPrompt("https://example.com/", false);
  assert.ok(!lines.includes(RULE));
  assert.ok(lines.some((l) => l.includes("untrusted data")));
});

test("the section no longer mentions a browser agent", () => {
  assert.ok(!/browser_agent/.test(browserPrompt("https://example.com/", true).join("\n")));
});

test("browserEnabled false drops the Browser section and the browser from the facts rule", () => {
  const store = new ConfigStore();
  assert.ok(systemPrompt(store).includes("## Browser"));
  store.patchConfig({ browserEnabled: false, webSearchEnabled: true });
  const text = systemPrompt(store);
  assert.ok(!text.includes("## Browser") && !text.includes("browser_"));
  assert.ok(text.includes("web_search and fetch_content."));
});
