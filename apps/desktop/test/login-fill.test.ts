import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoginFill, OTP_ATTRS, OTP_PROMPT } from "../src/login-fill.ts";

const SECRET = "hunter2-secret";
const META = { id: "id-1", label: "Shop", origin: "https://shop.example.com", username: "ann" };
const vault = {
  list: async () => [META, { ...META, id: "id-2", label: "Other" }],
  get: async () => ({ meta: META, username: "ann", password: SECRET }),
};
type Found = { username: boolean; password: boolean; otp: boolean; active: boolean };
const F = (o: Partial<Found>): Found => ({ username: false, password: false, otp: false, active: true, ...o });
const BOTH = F({ username: true, password: true });

/** `page` answers every locator call given the actions taken so far (inserts and Enter presses). */
function setup(page: (calls: string[], verify: boolean) => Found, opts: { url?: string; onInsert?: () => void; vaultImpl?: typeof vault } = {}) {
  const calls: string[] = [];
  const scripts: string[] = [];
  let url = opts.url ?? "https://shop.example.com/login";
  let t = 0;
  const navs = new Set<(u: string) => void>();
  const pane = {
    getURL: () => url,
    runInPage: async (s: string) => (scripts.push(s), page(calls, s.endsWith(", true)"))),
    insertText: async (x: string) => (calls.push(`insert:${x}`), opts.onInsert?.()),
    pressEnter: async () => void calls.push("enter"),
    onNavigate: (cb: (u: string) => void) => (navs.add(cb), () => navs.delete(cb)),
  };
  const fill = createLoginFill({ vault: opts.vaultImpl ?? vault, pane, now: () => t, sleep: async (ms) => void (t += ms) });
  return { fill, calls, scripts, go: (u: string) => ((url = u), navs.forEach((cb) => cb(u))) };
}
const signedIn = (calls: string[]) => (calls.filter((c) => c === "enter").length >= 1 && calls.some((c) => c.includes(SECRET)) ? F({}) : BOTH);

test("resolves by id and by label, rejects unknown without echoing it", async () => {
  for (const site of ["id-1", "Shop"]) {
    const s = setup(signedIn);
    assert.equal((await s.fill.fill(site)).ok, true);
  }
  const s = setup(() => F({}));
  assert.deepEqual(await s.fill.fill("evil<script>"), { ok: false, note: "No saved login with that name." });
  assert.equal(s.scripts.length, 0);
});

test("origin mismatch before filling inserts nothing", async () => {
  const s = setup(() => BOTH, { url: "https://evil.example.com/login" });
  const r = await s.fill.fill("Shop");
  assert.match(r.note, /not the saved site/);
  assert.deepEqual(s.calls, []);
  assert.equal(s.scripts.length, 0);
});

test("navigation to another origin mid-fill aborts before the password", async () => {
  const state: { go?: (u: string) => void } = {};
  const s = setup(() => BOTH, { onInsert: () => state.go?.("https://evil.example.com/") });
  state.go = s.go;
  const r = await s.fill.fill("Shop");
  assert.match(r.note, /not the saved site/);
  assert.deepEqual(s.calls, ["insert:ann"]);
});

test("focus not on the intended field aborts before inserting", async () => {
  const s = setup((_c, verify) => (verify ? F({ username: true, password: true, active: false }) : BOTH));
  const r = await s.fill.fill("Shop");
  assert.match(r.note, /not the saved site/);
  assert.deepEqual(s.calls, []);
});

test("vault entry for a different origin is refused", async () => {
  const other = { ...vault, get: async () => ({ meta: { ...META, origin: "https://evil.example.com" }, username: "ann", password: SECRET }) };
  const s = setup(() => BOTH, { vaultImpl: other });
  assert.match((await s.fill.fill("Shop")).note, /not the saved site/);
  assert.deepEqual(s.calls, []);
});

test("single-step fill: username, password, Enter", async () => {
  const s = setup(signedIn);
  assert.deepEqual(await s.fill.fill("id-1"), { ok: true, note: "Signed in." });
  assert.deepEqual(s.calls, ["insert:ann", `insert:${SECRET}`, "enter"]);
});

test("two-step flow waits for the password field", async () => {
  const s = setup((c) => (c.includes(`insert:${SECRET}`) ? F({}) : c.includes("enter") ? F({ password: true }) : F({ username: true })));
  assert.equal((await s.fill.fill("Shop")).ok, true);
  assert.deepEqual(s.calls, ["insert:ann", "enter", `insert:${SECRET}`, "enter"]);
  for (const script of s.scripts) assert.ok(!script.includes(SECRET));
});

test("a code field stops the fill with a note", async () => {
  const before = setup(() => F({ otp: true }));
  assert.match((await before.fill.fill("Shop")).note, /asks for a code/);
  assert.deepEqual(before.calls, []);
  const after = setup((c) => (c.includes("enter") ? F({ otp: true }) : F({ password: true })));
  assert.match((await after.fill.fill("Shop")).note, /asks for a code/);
});

test("no form on the page", async () => {
  const s = setup(() => F({}));
  assert.deepEqual(await s.fill.fill("Shop"), { ok: false, note: "No sign-in form on this page." });
  assert.deepEqual(s.calls, []);
});

test("password still visible after submit is reported as not signed in", async () => {
  const s = setup(() => F({ password: true }));
  assert.deepEqual(await s.fill.fill("Shop"), { ok: false, note: "Sign-in did not go through. Ask the owner to check." });
  assert.deepEqual(s.calls, [`insert:${SECRET}`, "enter"]);
});

test("redirect to another origin after submit is read-only", async () => {
  const redirect = (outcome: Found, expected: { ok: boolean; note: RegExp }) => async () => {
    const s = setup((c) => (c.includes("enter") ? outcome : F({ password: true })));
    const orig = s.calls.push.bind(s.calls);
    s.calls.push = (...x: string[]) => (x[0] === "enter" && s.go("https://sso.example.org/"), orig(...x));
    const r = await s.fill.fill("Shop");
    assert.equal(r.ok, expected.ok);
    assert.match(r.note, expected.note);
    assert.deepEqual([...s.calls], [`insert:${SECRET}`, "enter"]);
  };
  await redirect(F({}), { ok: true, note: /Signed in/ })();
  await redirect(F({ otp: true }), { ok: false, note: /asks for a code/ })();
  await redirect(F({ password: true }), { ok: false, note: /did not go through/ })();
});

test("the password never appears in a script or a note", async () => {
  const s = setup(signedIn);
  const r = await s.fill.fill("Shop");
  assert.ok(s.scripts.length > 0);
  for (const script of s.scripts) assert.ok(!script.includes(SECRET) && !script.includes("ann"));
  assert.ok(!r.note.includes(SECRET));
});

test("concurrent fills run one after another", async () => {
  const s = setup(signedIn);
  const [a, b] = await Promise.all([s.fill.fill("Shop"), s.fill.fill("Shop")]);
  assert.equal(a.ok, true);
  assert.match(b.note, /No sign-in form/);
  assert.deepEqual(s.calls, ["insert:ann", `insert:${SECRET}`, "enter"]);
});

test("code-field patterns", () => {
  for (const hit of ["otp", "user_otp", "2fa-code", "mfa", "totp", "one-time-code", "verificationCode", "verification_code", "security code"]) assert.ok(OTP_ATTRS.test(hit), hit);
  for (const miss of ["hotpink", "notpad", "footprint", "username", "email", "password"]) assert.ok(!OTP_ATTRS.test(miss), miss);
  assert.ok(OTP_PROMPT.test("Enter the 6-digit code"));
  assert.ok(OTP_PROMPT.test("six digit code"));
  assert.ok(!OTP_PROMPT.test("Email address"));
});
