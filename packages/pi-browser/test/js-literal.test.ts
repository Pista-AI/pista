import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { call, jsLiteral } from "../src/page-scripts.ts";

test("jsLiteral escapes characters that are unsafe in embedded script text", () => {
  const out = jsLiteral("</script>\u2028\u2029 a/b > c");
  assert.doesNotMatch(out, /[<>\/\u2028\u2029]/);
  assert.equal(runInNewContext(out), "</script>\u2028\u2029 a/b > c");
});

test("jsLiteral round-trips objects, null and undefined", () => {
  const value = { a: ["</x>", 1, null], "k/ey": "\u2028" };
  assert.equal(JSON.stringify(runInNewContext(`(${jsLiteral(value)})`)), JSON.stringify(value));
  assert.equal(jsLiteral(undefined), "null");
});

test("call passes arguments as escaped literals", () => {
  const src = call((s: string) => s, "</script>\u2028");
  assert.doesNotMatch(src.slice(src.lastIndexOf("})(")), /[<\u2028]/);
});
