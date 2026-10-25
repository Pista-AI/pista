import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGIN_CANCELLED, type HostEvent } from "@pista/protocol";
import { cancelLogin, forgetSubject, listProviders, login } from "./auth.ts";

type LoginFn = (provider: string, type: string, interaction: { signal?: AbortSignal; notify(e: unknown): void }) => Promise<unknown>;

function setup(loginFn: LoginFn, oauth = true) {
  const events: HostEvent[] = [];
  const logouts: string[] = [];
  const hub = { emit: (e: HostEvent) => events.push(e), ask: async () => null } as never;
  const models = {
    login: loginFn,
    logout: async (id: string) => void logouts.push(id),
    getProviders: () => [{ id: "corp", name: "Corp", auth: { oauth: {} } }],
    getProviderAuthStatus: () => ({ configured: oauth }),
    isUsingOAuth: () => oauth,
  } as never;
  return { events, hub, models, logouts };
}

const notices = (events: HostEvent[]) => events.filter((e) => e.type === "auth.notice") as Extract<HostEvent, { type: "auth.notice" }>[];

test("a device_code event becomes a notice with the code, link and expiry", async () => {
  const { events, hub, models } = setup(async (_p, _t, i) => {
    i.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "https://idp.example/device", expiresInSeconds: 600 });
    return { subject: "user-42" };
  });
  const before = Date.now();
  await login(models, hub, "corp", "oauth", "dev");
  const [code, done] = notices(events);
  assert.equal(code!.kind, "device_code");
  assert.equal(code!.code, "ABCD-1234");
  assert.equal(code!.url, "https://idp.example/device");
  assert.ok(code!.expiresAt! >= before + 600_000 && code!.expiresAt! <= Date.now() + 600_000);
  assert.deepEqual([done!.kind, done!.done, done!.error], ["done", true, undefined]);
  assert.equal(listProviders(models, null)[0]!.subject, "user-42");
});

test("auth.cancel aborts the in-flight sign-in, which rejects as cancelled", async () => {
  let seen: AbortSignal | undefined;
  const { events, hub, models } = setup((_p, _t, i) => {
    seen = i.signal;
    return new Promise((_, reject) => i.signal?.addEventListener("abort", () => reject(new Error("aborted by pi"))));
  });
  const running = login(models, hub, "corp", "oauth", "dev");
  await new Promise((r) => setTimeout(r, 5));
  cancelLogin("corp");
  await assert.rejects(running, new RegExp(LOGIN_CANCELLED));
  assert.equal(seen?.aborted, true);
  const last = notices(events).at(-1)!;
  assert.deepEqual([last.done, last.error], [true, LOGIN_CANCELLED]);
});

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test("a second sign-in on the same provider aborts the first without signing out", async () => {
  const signals: AbortSignal[] = [];
  const { hub, models, logouts } = setup((_p, _t, i) => {
    signals.push(i.signal!);
    if (signals.length === 1) return new Promise((_, reject) => i.signal!.addEventListener("abort", () => reject(new Error("aborted by pi"))));
    return Promise.resolve({ subject: "second" });
  });
  const first = login(models, hub, "corp", "oauth", "dev");
  first.catch(() => {});
  await tick();
  await login(models, hub, "corp", "oauth", "dev");
  await assert.rejects(first, new RegExp(LOGIN_CANCELLED));
  assert.equal(signals[0]!.aborted, true);
  assert.equal(signals[1]!.aborted, false);
  assert.deepEqual(logouts, []);
});

test("a login that resolves after the user cancelled is signed out again", async () => {
  let finish!: (v: unknown) => void;
  const { events, hub, models, logouts } = setup(() => new Promise((resolve) => (finish = resolve)));
  const running = login(models, hub, "corp", "oauth", "dev");
  await tick();
  cancelLogin("corp");
  await assert.rejects(running, new RegExp(LOGIN_CANCELLED));
  assert.deepEqual(logouts, []);
  finish({ subject: "late" });
  await tick();
  assert.deepEqual(logouts, ["corp"]);
  assert.equal(notices(events).at(-1)!.error, LOGIN_CANCELLED);
});

test("a login that fails after the user cancelled does not sign out", async () => {
  let fail!: (e: Error) => void;
  const { hub, models, logouts } = setup(() => new Promise((_, reject) => (fail = reject)));
  const running = login(models, hub, "corp", "oauth", "dev");
  await tick();
  cancelLogin("corp");
  await assert.rejects(running);
  fail(new Error("boom"));
  await tick();
  assert.deepEqual(logouts, []);
});

test("forgetSubject hides the remembered user", async () => {
  const { hub, models } = setup(async () => ({ subject: "user-1" }));
  await login(models, hub, "corp", "oauth", "dev");
  assert.equal(listProviders(models, null)[0]!.subject, "user-1");
  forgetSubject("corp");
  assert.equal(listProviders(models, null)[0]!.subject, undefined);
});
