import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTurnError, safeFirstLine } from "../src/lib/errors.ts";

test("an expired Codex login names the provider and says what to do, without the body", () => {
  const msg = 'OAuth refresh failed for openai-codex: OpenAI Codex token refresh failed (401): {"error":{"message":"Your refresh token has already been used","code":"refresh_token_reused"}}';
  const e = describeTurnError(msg, "OpenAI (ChatGPT Plus/Pro)");
  assert.equal(e.kind, "auth");
  assert.equal(e.text, "OpenAI (ChatGPT Plus/Pro): sign-in expired or was rejected. Sign in again in Settings, or switch this thread to another model.");
  assert.ok(!e.text.includes("{"));
});

test("missing and invalid keys count as auth failures", () => {
  assert.equal(describeTurnError("No API key for provider: nebius", "Nebius").kind, "auth");
  assert.equal(describeTurnError("Incorrect API key provided", "OpenAI").kind, "auth");
  assert.equal(describeTurnError("403 Forbidden", "X").kind, "auth");
});

test("429 and network errors get a short reason", () => {
  assert.equal(describeTurnError('429 Too Many Requests {"error":"slow down"}', "Nebius").text, "Nebius: rate limit reached. Wait a moment and try again.");
  assert.equal(describeTurnError("TypeError: fetch failed", "Nebius").text, "Nebius: could not reach the service. Check your connection and try again.");
});

test("other errors show a truncated first line only", () => {
  assert.equal(describeTurnError("Model exploded\nstack trace here", "P").text, "P: Model exploded");
  assert.ok(describeTurnError("x".repeat(100) + " " + "y".repeat(200), "P").text.length <= 3 + 161);
  assert.equal(describeTurnError(undefined, "P").text, "P: the request failed. Check Settings and try again.");
});

test("token-like strings are never rendered", () => {
  const line = safeFirstLine("Bad request with key sk-abc123DEF456ghi789 and Bearer eyJhbGciOi.abc.def and QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5 end");
  assert.ok(!/sk-|Bearer|QUJD/.test(line), line);
  assert.ok(line.includes("Bad request"));
});

test("urls, key pairs, sk_ keys and quoted bodies are stripped", () => {
  assert.ok(!/api_key|abc123|https/.test(safeFirstLine("Request to https://api.x.com/v1?api_key=abc123 failed badly")));
  assert.ok(!safeFirstLine("Rejected key sk_live_abcDEF123456 for this account").includes("sk_live"));
  assert.ok(!safeFirstLine("Upstream refused x-api-key: abcd1234 for this call").includes("abcd1234"));
  assert.equal(safeFirstLine('Bad gateway "error":"internal detail"'), "Bad gateway");
});

test("too little left falls back to a generic line", () => {
  assert.equal(describeTurnError('{"error":"x"}', "P").text, "P: the request failed. Check Settings and try again.");
  assert.equal(describeTurnError("https://a.b/c?token=zzz", "P").text, "P: the request failed. Check Settings and try again.");
});

test("a bare 401 or the word authentication is not an auth failure", () => {
  assert.equal(describeTurnError("400 Bad request: prompt contains 401 tokens", "P").kind, "other");
  assert.equal(describeTurnError("Authentication of the thing took too long", "P").kind, "other");
  assert.equal(describeTurnError("Request failed (401)", "P").kind, "auth");
  assert.equal(describeTurnError("HTTP 403 from server", "P").kind, "auth");
});
