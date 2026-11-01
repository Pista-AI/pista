import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { clearConfigValueCache, resolveConfigValue } from "./config-value.ts";

beforeEach(() => clearConfigValueCache());

test("literals pass through and undefined stays undefined", () => {
  assert.equal(resolveConfigValue("sk-abc"), "sk-abc");
  assert.equal(resolveConfigValue(undefined), undefined);
});

test("$VAR and ${VAR} prefer the env map over process.env", () => {
  process.env.PISTA_CV_TEST = "from-process";
  try {
    assert.equal(resolveConfigValue("$PISTA_CV_TEST", { PISTA_CV_TEST: "from-map" }), "from-map");
    assert.equal(resolveConfigValue("pre-${PISTA_CV_TEST}-post"), "pre-from-process-post");
    assert.equal(resolveConfigValue("$PISTA_CV_MISSING_VAR"), undefined);
  } finally {
    delete process.env.PISTA_CV_TEST;
  }
});

test("escapes: $$ and leading $!", () => {
  assert.equal(resolveConfigValue("a$$b"), "a$b");
  assert.equal(resolveConfigValue("$!literal"), "!literal");
});

test("!cmd runs through exec and is cached by the full string", () => {
  let calls = 0;
  const exec = (cmd: string) => {
    calls++;
    return `out:${cmd}`;
  };
  assert.equal(resolveConfigValue("!echo hi", undefined, { exec }), "out:echo hi");
  assert.equal(resolveConfigValue("!echo hi", undefined, { exec }), "out:echo hi");
  assert.equal(calls, 1);
  assert.equal(resolveConfigValue("!echo other", undefined, { exec }), "out:echo other");
  assert.equal(calls, 2);
});

test("a failing command resolves to undefined", () => {
  assert.equal(resolveConfigValue("!nope", undefined, { exec: () => undefined }), undefined);
});

test("default exec runs a real command and trims", () => {
  assert.equal(resolveConfigValue("!printf ' hello \\n'"), "hello");
  assert.equal(resolveConfigValue("!exit 3"), undefined);
});
