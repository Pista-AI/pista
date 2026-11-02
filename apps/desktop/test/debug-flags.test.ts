import assert from "node:assert/strict";
import { test } from "node:test";
import { findDebugFlag } from "../src/debug-flags.ts";

test("finds debugger and inspector switches", () => {
  assert.equal(findDebugFlag(["Pista", "--remote-debugging-port=9222"]), "--remote-debugging-port");
  assert.equal(findDebugFlag(["Pista", "--remote-debugging-pipe"]), "--remote-debugging-pipe");
  assert.equal(findDebugFlag(["Pista", "--inspect=127.0.0.1:9229"]), "--inspect");
  assert.equal(findDebugFlag(["Pista", "--inspect-brk"]), "--inspect-brk");
  assert.equal(findDebugFlag(["Pista", "--js-flags=--expose-gc"]), "--js-flags");
});

test("ignores ordinary arguments", () => {
  assert.equal(findDebugFlag(["Pista", "--no-sandbox", "/some/path"]), undefined);
  assert.equal(findDebugFlag([]), undefined);
});
