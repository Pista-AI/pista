import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSuiteEnv } from "./suite-env.ts";

test("without PISTA_HOME or PI_CODING_AGENT_DIR the suite gets a fresh temp home and explicit agent and memory dirs", () => {
  const { set, temp } = resolveSuiteEnv({ HOME: "/Users/me" }, () => "/tmp/fresh");
  assert.equal(temp, "/tmp/fresh");
  assert.deepEqual(set, { PISTA_HOME: "/tmp/fresh", PI_CODING_AGENT_DIR: "/tmp/fresh/pi", PI_MEMORY_DIR: "/tmp/fresh/pi/memory" });
});

test("a given PISTA_HOME is used as is, but its agent dir is still pinned so ~/.pi/agent is never copied", () => {
  const { set, temp } = resolveSuiteEnv({ PISTA_HOME: "/work/home" }, () => assert.fail("no temp dir expected"));
  assert.equal(temp, undefined);
  assert.deepEqual(set, { PI_CODING_AGENT_DIR: "/work/home/pi", PI_MEMORY_DIR: "/work/home/pi/memory" });
});

test("a given PI_CODING_AGENT_DIR alone is respected and nothing else is invented", () => {
  const { set, temp } = resolveSuiteEnv({ PI_CODING_AGENT_DIR: "/x/agent" }, () => assert.fail("no temp dir expected"));
  assert.equal(temp, undefined);
  assert.deepEqual(set, { PI_MEMORY_DIR: "/x/agent/memory" });
});

test("explicit values for everything leave the environment alone", () => {
  const { set } = resolveSuiteEnv({ PISTA_HOME: "/h", PI_CODING_AGENT_DIR: "/a", PI_MEMORY_DIR: "/m" }, () => assert.fail("no temp dir expected"));
  assert.deepEqual(set, {});
});
