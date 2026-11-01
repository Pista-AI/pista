import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoginFill } from "../src/login-fill.ts";

const SECRET = "hunter2-secret";
const META = { id: "id-1", label: "Shop", origin: "https://shop.example.com", username: "ann" };
const vault = {
  list: async () => [META, { ...META, id: "id-2", label: "Other" }],
  get: async () => ({ meta: META, username: "ann", password: SECRET }),
};
const F = (o: Partial<Record<"username" | "password" | "otp" | "submit", boolean>>) => ({ username: false, password: false, otp: false, submit: true, ...o });

/** `found` answers locator calls in order (the last answer repeats); focus calls get the same treatment. */
function setup(found: unknown[], opts: { url?: string; onInsert?: (n: number) => void } = {}) {
  const calls: string[] = [];
  const scripts: string[] = [];
  let url = opts.url ?? "https://shop.example.com/login";
  let i = 0;
  let t = 0;
  const navs = new Set<(u: string) => void>();
  const pane = {
    getURL: () => url,
    runInPage: async (s: string) => {
      scripts.push(s);
      return found[Math.min(i++, found.length - 1)];
    },
    insertText: async (x: string) => {
      calls.push(`insert:${x}`);
      opts.onInsert?.(calls.length);
    },
    pressEnter: async () => void calls.push("enter"),
    onNavigate: (cb: (u: string) => void) => (navs.add(cb), () => navs.delete(cb)),
  };
  const fill = createLoginFill({ vault, pane, now: () => t, sleep: async (ms) => void (t += ms) });
  return { fill, calls, scripts, go: (u: string) => ((url = u), navs.forEach((cb) => cb(u))) };
}

test("resolves by id and by label, rejects unknown without echoing it", async () => {
  for (const site of ["id-1", "Shop"]) {
    const s = setup([F({ username: true, password: true }), F({ username: true }), F({ password: true }), F({})]);
    assert.equal((await s.fill.fill(site)).ok, true);
  }
  const s = setup([F({})]);
  const r = await s.fill.fill("evil<script>");
  assert.deepEqual(r, { ok: false, note: "No saved login with that name." });
  assert.equal(s.scripts.length, 0);
});

test("origin mismatch before filling inserts nothing", async () => {
  const s = setup([F({ username: true, password: true })], { url: "https://evil.example.com/login" });
  const r = await s.fill.fill("Shop");
  assert.equal(r.ok, false);
  assert.match(r.note, /not the saved site/);
  assert.deepEqual(s.calls, []);
  assert.equal(s.scripts.length, 0);
});

test("navigation to another origin mid-fill aborts before the password", async () => {
  const state: { go?: (u: string) => void } = {};
  const s = setup([F({ username: true, password: true })], { onInsert: () => state.go?.("https://evil.example.com/") });
  state.go = s.go;
  const r = await s.fill.fill("Shop");
  assert.equal(r.ok, false);
  assert.match(r.note, /not the saved site/);
  assert.deepEqual(s.calls, ["insert:ann"]);
});

test("single-step fill: username, password, Enter", async () => {
  const s = setup([F({ username: true, password: true }), F({ username: true, password: true }), F({ username: true, password: true }), F({})]);
  const r = await s.fill.fill("id-1");
  assert.deepEqual(r, { ok: true, note: "Signed in." });
  assert.deepEqual(s.calls, ["insert:ann", `insert:${SECRET}`, "enter"]);
});

test("two-step flow waits for the password field", async () => {
  const s = setup([F({ username: true }), F({ username: true }), F({}), F({ password: true }), F({ password: true }), F({})]);
  const r = await s.fill.fill("Shop");
  assert.equal(r.ok, true);
  assert.deepEqual(s.calls, ["insert:ann", "enter", `insert:${SECRET}`, "enter"]);
});

test("a code field stops the fill with a note", async () => {
  const before = setup([F({ otp: true })]);
  assert.match((await before.fill.fill("Shop")).note, /asks for a code/);
  assert.deepEqual(before.calls, []);
  const after = setup([F({ password: true }), F({ password: true }), F({ otp: true })]);
  const r = await after.fill.fill("Shop");
  assert.match(r.note, /asks for a code/);
});

test("no form on the page", async () => {
  const s = setup([F({})]);
  assert.deepEqual(await s.fill.fill("Shop"), { ok: false, note: "No sign-in form on this page." });
  assert.deepEqual(s.calls, []);
});

test("password still visible after submit is reported as not signed in", async () => {
  const s = setup([F({ password: true })]);
  const r = await s.fill.fill("Shop");
  assert.deepEqual(r, { ok: false, note: "Sign-in did not go through. Ask the owner to check." });
  assert.deepEqual(s.calls, [`insert:${SECRET}`, "enter"]);
});

test("the password never appears in a script or a note", async () => {
  const s = setup([F({ username: true, password: true }), F({ username: true, password: true }), F({ username: true, password: true }), F({})]);
  const r = await s.fill.fill("Shop");
  assert.ok(s.scripts.length > 0);
  for (const script of s.scripts) assert.ok(!script.includes(SECRET) && !script.includes("ann"));
  assert.ok(!r.note.includes(SECRET));
});
