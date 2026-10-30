import assert from "node:assert/strict";
import { test } from "node:test";
import { parentModel } from "./parent-model.ts";

const pin = { provider: "nebius", id: "pro" };
const cli = { provider: "nebius", id: "flash" };
const fake = { provider: "faux", id: "f" };

test("a preset's defaultModel wins over --model, the fake model wins over both", () => {
  assert.deepEqual(parentModel({ config: { defaultModel: pin } }, undefined, cli), pin);
  assert.deepEqual(parentModel({ config: {} }, undefined, cli), cli);
  assert.deepEqual(parentModel({ config: { defaultModel: pin } }, fake, cli), fake);
});
