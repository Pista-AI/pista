import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUiCsp } from "../src/csp.ts";

test("packaged policy: self only, no inline code, no eval", () => {
  const csp = buildUiCsp("http://127.0.0.1:4317/", { dev: false });
  assert.equal(
    csp,
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4317; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  assert.ok(!csp.includes("unsafe-eval") && !csp.includes("unsafe-inline"));
});

test("dev policy adds only Vite's inline preamble, inline styles and the dev server origin", () => {
  const csp = buildUiCsp("http://localhost:5320", { dev: true });
  assert.match(csp, /script-src 'self' 'unsafe-inline';/);
  assert.match(csp, /style-src 'self' 'unsafe-inline';/);
  assert.match(csp, /connect-src 'self' ws:\/\/localhost:5320 http:\/\/localhost:5320;/);
  assert.ok(!csp.includes("unsafe-eval"));
});

test("object-src is none and framing is refused in every mode", () => {
  for (const dev of [true, false]) {
    const csp = buildUiCsp("https://host.test:8443", { dev });
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /wss:\/\/host\.test:8443/);
  }
});
