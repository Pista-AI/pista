import assert from "node:assert/strict";
import { test } from "node:test";
import { guardDriver } from "../src/domains.ts";
import type { BrowserDriver, SavedLoginMeta } from "../src/driver.ts";
import { registerBrowserTools } from "../src/tools.ts";

const saved: SavedLoginMeta[] = [{ id: "id-1", label: "Fixture", origin: "https://shop.test", username: "ann" }];

function setup(overrides: Partial<BrowserDriver> = {}, url = "https://shop.test/login") {
  const fills: string[] = [];
  const driver = {
    state: async () => ({ url, title: "", loading: false }),
    loginList: async () => saved,
    loginFill: async (site: string) => (fills.push(site), { ok: true, note: "Signed in." }),
    ...overrides,
  } as unknown as BrowserDriver;
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<{ content: { text: string }[] }> }>();
  registerBrowserTools({ registerTool: (t: { name: string; execute: never }) => tools.set(t.name, t), on: () => undefined } as never, () => driver, { traceDir: "off" });
  const run = async (site: string) => JSON.parse((await tools.get("browser_login")!.execute("1", { site }, undefined)).content[0]!.text);
  return { tools, run, fills };
}

test("browser_login: an unknown name lists the saved labels and fills nothing", async () => {
  const s = setup();
  assert.deepEqual(await s.run("Nope"), { ok: false, note: "No saved login with that name.", saved: ["Fixture"] });
  assert.deepEqual(s.fills, []);
});

test("browser_login: another origin than the saved one is refused before any fill", async () => {
  const s = setup({}, "https://evil.test/login");
  assert.deepEqual(await s.run("Fixture"), { ok: false, note: "Open the saved site's sign-in page first.", origin: "https://shop.test" });
  assert.deepEqual(s.fills, []);
});

test("browser_login: fills by the name the model gave and returns only ok and note", async () => {
  const s = setup();
  assert.deepEqual(await s.run("Fixture"), { ok: true, note: "Signed in." });
  assert.deepEqual(s.fills, ["Fixture"]);
});

test("browser_login: not registered when the driver cannot fill", () => {
  assert.equal(setup({ loginFill: undefined }).tools.has("browser_login"), false);
});

test("domain rules: a denied saved origin is never filled", async () => {
  const fills: string[] = [];
  const inner = {
    state: async () => ({ url: "https://shop.test/login", title: "", loading: false }),
    loginList: async () => saved,
    loginFill: async (site: string) => (fills.push(site), { ok: true, note: "Signed in." }),
  } as unknown as BrowserDriver;
  const guarded = guardDriver(inner, { deniedDomains: ["shop.test"] });
  assert.deepEqual(await guarded.loginFill!("Fixture"), { ok: false, note: "That site is blocked by policy." });
  assert.deepEqual(fills, []);
  const open = guardDriver(inner, { deniedDomains: ["other.test"] });
  assert.equal((await open.loginFill!("Fixture")).ok, true);
});
