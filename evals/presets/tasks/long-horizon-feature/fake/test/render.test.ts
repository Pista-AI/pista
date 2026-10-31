import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTemplate } from "../src/notifications/render.ts";

test("renderTemplate", () => {
  assert.equal(renderTemplate("Hi {{ name }}, {{n}}", { name: "<Al>", n: 3 }), "Hi &lt;Al&gt;, 3");
  assert.throws(() => renderTemplate("{{x}}", {}), /missing variable: x/);
});
