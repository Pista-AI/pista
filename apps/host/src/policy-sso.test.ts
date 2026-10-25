import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ManagedPolicy, PolicyGateway } from "@pista/protocol";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerPolicyGateways } from "./policy-providers.ts";
import { oidcOAuth, type SsoCredentials } from "./policy-sso.ts";

// A mock identity provider on 127.0.0.1 (test fixture only). `tokenReplies` is consumed in order by device-code polls;
// `refreshReplies` by refresh_token grants.
type Reply = [status: number, body: Record<string, unknown>];
class MockIdp {
  server!: Server;
  issuer = "";
  deviceBody: Record<string, unknown> = { device_code: "DEV-CODE", user_code: "ABCD-EFGH", verification_uri: "https://idp.test/device", expires_in: 600, interval: 5 };
  tokenReplies: Reply[] = [];
  refreshReplies: Reply[] = [];
  discoveryOverride: Record<string, unknown> = {};
  /** Consumed by the next /token requests before any reply: "drop" kills the socket, "500" answers an empty 500. */
  faults: Array<"drop" | "500"> = [];
  requests: Array<{ path: string; form: URLSearchParams }> = [];

  async start() {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const path = (req as IncomingMessage).url ?? "";
      this.requests.push({ path, form });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (path === "/.well-known/openid-configuration") return send(200, { issuer: this.issuer, device_authorization_endpoint: `${this.issuer}/device`, token_endpoint: `${this.issuer}/token`, ...this.discoveryOverride });
      if (path === "/device") return send(200, this.deviceBody);
      if (path === "/redir") {
        res.writeHead(302, { location: `${this.issuer}/device` });
        return void res.end();
      }
      if (path === "/big") {
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ filler: "x".repeat(300 * 1024) }));
      }
      if (path === "/hang") return; // never answers
      if (path === "/token") {
        const fault = this.faults.shift();
        if (fault === "drop") return void req.socket.destroy();
        if (fault === "500") return send(500, {});
        const queue = form.get("grant_type") === "refresh_token" ? this.refreshReplies : this.tokenReplies;
        const next = queue.shift() ?? [400, { error: "authorization_pending" }];
        return send(next[0], next[1]);
      }
      send(404, {});
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this;
  }
  stop() {
    this.server.closeAllConnections();
    this.server.close();
  }
}

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const PENDING: Reply = [400, { error: "authorization_pending" }];
const gateway = (idp: MockIdp, auth: Partial<NonNullable<PolicyGateway["auth"]>> = {}, over: Partial<PolicyGateway> = {}): PolicyGateway => ({
  id: "corp-sso",
  name: "Corp SSO",
  kind: "openai-compatible",
  baseUrl: "https://llm.example.com/v1",
  auth: { type: "oidc", issuer: idp.issuer, clientId: "pista-client", scopes: ["openid", "offline_access", "api://corp/.default"], ...auth },
  models: [{ id: "m" }],
  ...over,
});
const FAST = { pollMs: 0, slowDownMs: 0 };
const idps: MockIdp[] = [];
const idp = async () => {
  const i = await new MockIdp().start();
  idps.push(i);
  return i;
};
after(() => idps.forEach((i) => i.stop()));
const noop = { onDeviceCode: () => {} };
const never = () => new AbortController().signal;

test("device flow: pending, slow_down, then success; the user code is announced and the credential carries what refresh needs", async () => {
  const mock = await idp();
  mock.tokenReplies = [PENDING, [400, { error: "slow_down" }], [200, { access_token: "ACCESS-1", refresh_token: "REFRESH-1", expires_in: 3600, id_token: jwt({ sub: "user-42" }) }]];
  const shown: unknown[] = [];
  const before = Date.now();
  const cred = await oidcOAuth(gateway(mock), fetch, FAST).login({ onDeviceCode: (info) => shown.push(info) });
  assert.deepEqual(shown, [{ userCode: "ABCD-EFGH", verificationUri: "https://idp.test/device", intervalSeconds: 5, expiresInSeconds: 600 }]);
  assert.equal(cred.access, "ACCESS-1");
  assert.equal(cred.refresh, "REFRESH-1");
  assert.equal(cred.tokenEndpoint, `${mock.issuer}/token`);
  assert.equal(cred.tokenKind, "access");
  assert.equal(cred.subject, "user-42");
  assert.ok(cred.expires > before + 3_000_000 && cred.expires < before + 3_600_000, "expiry is shortened by a lead time");
  const device = mock.requests.find((r) => r.path === "/device")!;
  assert.equal(device.form.get("client_id"), "pista-client");
  assert.equal(device.form.get("scope"), "openid offline_access api://corp/.default");
  assert.equal(device.form.has("audience"), false);
  const polls = mock.requests.filter((r) => r.path === "/token");
  assert.equal(polls.length, 3);
  assert.equal(polls[0]!.form.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
  assert.equal(polls[0]!.form.get("device_code"), "DEV-CODE");
});

test("verification_uri_complete is preferred, audience is sent, and token: id stores the ID token with its own expiry", async () => {
  const mock = await idp();
  mock.deviceBody = { ...mock.deviceBody, verification_uri_complete: "https://idp.test/device?user_code=ABCD-EFGH" };
  const exp = Math.floor(Date.now() / 1000) + 1800;
  mock.tokenReplies = [[200, { access_token: "A", id_token: jwt({ sub: "s", exp }), refresh_token: "R", expires_in: 7200 }]];
  const shown: Array<{ verificationUri: string }> = [];
  const cred = await oidcOAuth(gateway(mock, { token: "id", audience: "api://corp" }), fetch, FAST).login({ onDeviceCode: (i) => shown.push(i) });
  assert.equal(shown[0]!.verificationUri, "https://idp.test/device?user_code=ABCD-EFGH");
  assert.equal(mock.requests.find((r) => r.path === "/device")!.form.get("audience"), "api://corp");
  assert.equal(cred.tokenKind, "id");
  assert.equal(cred.access, jwt({ sub: "s", exp }));
  assert.ok(cred.expires <= exp * 1000 && cred.expires > exp * 1000 - 120_000);
});

test("token: id without an id_token fails clearly", async () => {
  const mock = await idp();
  mock.tokenReplies = [[200, { access_token: "A", refresh_token: "R", expires_in: 60 }]];
  await assert.rejects(oidcOAuth(gateway(mock, { token: "id" }), fetch, FAST).login(noop), /no ID token/);
});

test("access_denied and expired_token end the flow with a clear message", async () => {
  const mock = await idp();
  mock.tokenReplies = [PENDING, [400, { error: "access_denied" }]];
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /denied/);
  mock.tokenReplies = [[400, { error: "expired_token" }]];
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /expired/);
  mock.tokenReplies = [[400, { error: "invalid_client", error_description: `bad ${"x".repeat(60)} secret` }]];
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), (e: Error) => /invalid_client/.test(e.message) && !/x{30}/.test(e.message));
});

test("cancelling through the signal stops polling", async () => {
  const mock = await idp();
  const controller = new AbortController();
  mock.tokenReplies = [];
  const pending = oidcOAuth(gateway(mock), fetch, { pollMs: 20, slowDownMs: 0 }).login({ onDeviceCode: () => setTimeout(() => controller.abort(), 60), signal: controller.signal });
  await assert.rejects(pending, /cancelled/);
});

test("discovery problems: wrong issuer, no device endpoint, plain http to a non-loopback host", async () => {
  const mock = await idp();
  mock.discoveryOverride = { issuer: "https://evil.example.com" };
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /different issuer/);
  mock.discoveryOverride = { device_authorization_endpoint: undefined };
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /device authorization grant/);
  mock.discoveryOverride = { token_endpoint: "http://idp.example.com/token" };
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /must use https/);
  assert.equal(mock.requests.some((r) => r.path === "/device"), false);
});

const stored = (mock: MockIdp, over: Partial<SsoCredentials> = {}) => ({ access: "OLD", refresh: "REFRESH-1", expires: 0, issuer: mock.issuer, clientId: "pista-client", tokenEndpoint: `${mock.issuer}/token`, tokenKind: "access", ...over });

test("refresh rotates the refresh token when the IdP returns one and keeps the old one when it does not", async () => {
  const mock = await idp();
  const oauth = oidcOAuth(gateway(mock), fetch, FAST);
  mock.refreshReplies = [[200, { access_token: "ACCESS-2", refresh_token: "REFRESH-2", expires_in: 3600 }]];
  const rotated = await oauth.refreshToken(stored(mock), new AbortController().signal);
  assert.equal(rotated.access, "ACCESS-2");
  assert.equal(rotated.refresh, "REFRESH-2");
  const grant = mock.requests.find((r) => r.form.get("grant_type") === "refresh_token")!;
  assert.equal(grant.form.get("refresh_token"), "REFRESH-1");
  assert.equal(grant.form.get("client_id"), "pista-client");
  mock.refreshReplies = [[200, { access_token: "ACCESS-3", expires_in: 3600 }]];
  const kept = await oauth.refreshToken(stored(mock, { subject: "user-42" }), new AbortController().signal);
  assert.equal(kept.access, "ACCESS-3");
  assert.equal(kept.refresh, "REFRESH-1");
  assert.equal(kept.subject, "user-42");
  assert.equal(oauth.getApiKey(kept), "ACCESS-3");
});

test("refresh with invalid_grant asks for a new sign-in, other failures do not leak the token", async () => {
  const mock = await idp();
  const oauth = oidcOAuth(gateway(mock), fetch, FAST);
  mock.refreshReplies = [[400, { error: "invalid_grant", error_description: "token revoked" }]];
  await assert.rejects(oauth.refreshToken(stored(mock), new AbortController().signal), /Sign in again to Corp SSO/);
  mock.refreshReplies = [[500, { error: "server_error", error_description: "boom REFRESH-1-looks-like-a-long-token-value-123456" }]];
  await assert.rejects(oauth.refreshToken(stored(mock), new AbortController().signal), (e: Error) => /server_error/.test(e.message) && !/long-token-value/.test(e.message));
  await assert.rejects(oauth.refreshToken(stored(mock, { refresh: "" }), new AbortController().signal), /Sign in again/);
});

// -- against a real Pi ModelRuntime --------------------------------------------------------------

const policyOf = (gw: PolicyGateway, disableDirectLogin = true): ManagedPolicy => ({ version: 1, providers: { gateways: [gw], disableDirectLogin } });

test("a ModelRuntime registers the SSO gateway as OAuth-only, logs in, stores the credential, and sends the bearer", async () => {
  const mock = await idp();
  mock.tokenReplies = [PENDING, [200, { access_token: "ACCESS-RT", refresh_token: "REFRESH-RT", expires_in: 3600 }]];
  const dir = mkdtempSync(join(tmpdir(), "pista-sso-"));
  try {
    const authPath = join(dir, "auth.json");
    const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
    for (const kind of ["openai-compatible", "anthropic-compatible"] as const) {
      const gw = gateway(mock, {}, { id: `sso-${kind}`, kind });
      const result = registerPolicyGateways(policyOf(gw), {}, (id, config) => runtime.registerProvider(id, config), [], { options: FAST });
      assert.deepEqual(result, { registered: 1, warnings: [] });
    }
    // Only the OAuth method exists; a key login would defeat the point of SSO.
    const provider = runtime.getProviders().find((p) => p.id === "sso-openai-compatible")!;
    assert.equal(provider.auth.apiKey, undefined);
    assert.ok(provider.auth.oauth);
    assert.equal(runtime.getProviderAuthStatus("sso-openai-compatible").configured, false);

    const notices: unknown[] = [];
    const id = "sso-openai-compatible";
    await runtime.login(id, "oauth", { prompt: async () => { throw new Error("unexpected prompt"); }, notify: (e) => void notices.push(e) }, { getDeviceId: () => "d" });
    assert.ok(notices.some((n) => (n as { type: string; userCode?: string }).type === "device_code" && (n as { userCode?: string }).userCode === "ABCD-EFGH"));

    const file = JSON.parse(readFileSync(authPath, "utf8"))[id];
    assert.equal(file.type, "oauth");
    assert.equal(file.access, "ACCESS-RT");
    assert.equal(file.refresh, "REFRESH-RT");
    assert.equal(typeof file.expires, "number");
    assert.equal(file.tokenEndpoint, `${mock.issuer}/token`);
    assert.equal((await runtime.getAuth(runtime.getModel(id, "m")!))?.auth.apiKey, "ACCESS-RT");
    assert.equal(runtime.getProviderAuthStatus(id).configured, true);

    // An expired credential is refreshed at request time and the rotated one is persisted.
    mock.refreshReplies = [[200, { access_token: "ACCESS-RT2", refresh_token: "REFRESH-RT2", expires_in: 3600 }]];
    const raw = JSON.parse(readFileSync(authPath, "utf8"));
    raw[id].expires = Date.now() - 1000;
    (await import("node:fs")).writeFileSync(authPath, JSON.stringify(raw));
    const runtime2 = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
    registerPolicyGateways(policyOf(gateway(mock, {}, { id })), {}, (pid, config) => runtime2.registerProvider(pid, config), [], { options: FAST });
    assert.equal((await runtime2.getAuth(runtime2.getModel(id, "m")!))?.auth.apiKey, "ACCESS-RT2");
    assert.equal(JSON.parse(readFileSync(authPath, "utf8"))[id].refresh, "REFRESH-RT2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the anthropic-compatible SSO gateway sends the stored token as Authorization: Bearer", async () => {
  const mock = await idp();
  const dir = mkdtempSync(join(tmpdir(), "pista-sso-"));
  try {
    const authPath = join(dir, "auth.json");
    const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
    const gw = gateway(mock, {}, { id: "sso-a", kind: "anthropic-compatible" });
    registerPolicyGateways(policyOf(gw), {}, (id, config) => runtime.registerProvider(id, config), [], { options: FAST });
    mock.tokenReplies = [[200, { access_token: "ACCESS-A", refresh_token: "R", expires_in: 3600 }]];
    await runtime.login("sso-a", "oauth", { prompt: async () => "", notify: () => {} }, { getDeviceId: () => "d" });
    const auth = (await runtime.getAuth(runtime.getModel("sso-a", "m")!))?.auth;
    assert.equal(auth?.headers?.Authorization, "Bearer ACCESS-A");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registration warns when both auth and apiKeyEnv are present and never adds an apiKey", () => {
  const calls: Array<{ id: string; config: Record<string, unknown> }> = [];
  const gw = { ...gateway({ issuer: "https://idp.example.com" } as MockIdp), apiKeyEnv: "SOME_KEY" };
  const result = registerPolicyGateways(policyOf(gw), {}, ((id: string, config: Record<string, unknown>) => void calls.push({ id, config })) as never);
  assert.equal(result.registered, 1);
  assert.match(result.warnings[0]!, /apiKeyEnv|SOME_KEY/);
  assert.equal("apiKey" in calls[0]!.config, false);
  assert.ok(calls[0]!.config.oauth);
});

// -- hardening ------------------------------------------------------------------------------------

test("a stored sign-in for another issuer or client is refused for refresh and as a bearer", async () => {
  const mock = await idp();
  const oauth = oidcOAuth(gateway(mock), fetch, FAST);
  for (const over of [{ issuer: "https://other.example.com" }, { clientId: "someone-else" }]) {
    await assert.rejects(oauth.refreshToken(stored(mock, over), never()), /Sign in again to Corp SSO.*different identity provider/);
    assert.throws(() => oauth.getApiKey(stored(mock, over)), /Sign in again to Corp SSO/);
  }
  assert.equal(mock.requests.some((r) => r.path === "/token"), false);
});

test("a response body over 256 KB is refused", async () => {
  const mock = await idp();
  mock.discoveryOverride = { device_authorization_endpoint: `${mock.issuer}/big` };
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /too large/);
});

test("the device code lifetime is clamped to 15 minutes and the poll interval to at least a second", async () => {
  const mock = await idp();
  mock.deviceBody = { ...mock.deviceBody, expires_in: 3600, interval: 0 };
  mock.tokenReplies = [[200, { access_token: "A", refresh_token: "R", expires_in: 60 }]];
  const shown: Array<{ intervalSeconds?: number; expiresInSeconds?: number }> = [];
  const started = Date.now();
  await oidcOAuth(gateway(mock), fetch).login({ onDeviceCode: (i) => shown.push(i) });
  assert.deepEqual([shown[0]!.intervalSeconds, shown[0]!.expiresInSeconds], [1, 900]);
  assert.ok(Date.now() - started >= 950, "waited the clamped interval before the first poll");
});

test("polling tolerates transport errors and 5xx answers up to a budget of three in a row", async () => {
  const mock = await idp();
  mock.faults = ["drop", "500", "drop"];
  mock.tokenReplies = [PENDING, [200, { access_token: "A", refresh_token: "R", expires_in: 3600 }]];
  const cred = await oidcOAuth(gateway(mock), fetch, FAST).login(noop);
  assert.equal(cred.access, "A");

  const failing = await idp();
  failing.faults = ["drop", "drop", "drop", "drop"];
  failing.tokenReplies = [[200, { access_token: "A", expires_in: 60 }]];
  await assert.rejects(oidcOAuth(gateway(failing), fetch, FAST).login(noop), /Could not reach/);

  // An answer in between resets the count.
  const mixed = await idp();
  mixed.faults = ["500", "500"];
  mixed.tokenReplies = [PENDING, [200, { access_token: "A", expires_in: 60 }]];
  assert.equal((await oidcOAuth(gateway(mixed), fetch, FAST).login(noop)).access, "A");
});

test("refresh keeps a still-valid token when the IdP is unreachable, and fails when it has expired", async () => {
  const mock = await idp();
  const oauth = oidcOAuth(gateway(mock), fetch, FAST);
  mock.faults = ["drop"];
  const live = stored(mock, { expires: Date.now() + 120_000 });
  assert.deepEqual(await oauth.refreshToken(live, never()), live);
  mock.faults = ["500"];
  assert.deepEqual(await oauth.refreshToken(live, never()), live);
  mock.faults = ["drop"];
  await assert.rejects(oauth.refreshToken(stored(mock, { expires: Date.now() - 1 }), never()), /Could not reach/);
  // An OAuth error is an answer, not an outage.
  mock.refreshReplies = [[400, { error: "invalid_grant" }]];
  await assert.rejects(oauth.refreshToken(live, never()), /Sign in again/);
});

test("an http device endpoint on a non-loopback host, a redirect and a hung request are all refused", async () => {
  const mock = await idp();
  mock.discoveryOverride = { device_authorization_endpoint: "http://idp.example.com/device" };
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /device_authorization_endpoint must use https/);

  mock.discoveryOverride = { device_authorization_endpoint: `${mock.issuer}/redir` };
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /Could not reach/);
  assert.equal(mock.requests.filter((r) => r.path === "/device").length, 0, "the redirect was not followed");

  mock.discoveryOverride = { device_authorization_endpoint: `${mock.issuer}/hang` };
  await assert.rejects(oidcOAuth(gateway(mock), fetch, { ...FAST, timeoutMs: 100 }).login(noop), /timed out/);
});

test("http is only accepted when the issuer itself is loopback", async () => {
  const mock = await idp();
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ issuer: "https://idp.example.com", device_authorization_endpoint: "http://127.0.0.1/device", token_endpoint: "https://idp.example.com/token" }), { status: 200 });
  }) as unknown as typeof fetch;
  await assert.rejects(oidcOAuth(gateway(mock, { issuer: "https://idp.example.com" }), fake, FAST).login(noop), /device_authorization_endpoint must use https/);
  assert.deepEqual(calls, ["https://idp.example.com/.well-known/openid-configuration"]);
});

test("the issuer must match the discovery document exactly, a trailing slash is only dropped to build the URL", async () => {
  const mock = await idp();
  mock.discoveryOverride = { issuer: `${mock.issuer}/` };
  await assert.rejects(oidcOAuth(gateway(mock), fetch, FAST).login(noop), /different issuer/);
  mock.discoveryOverride = { issuer: `${mock.issuer}/` };
  mock.tokenReplies = [[200, { access_token: "A", expires_in: 60 }]];
  assert.equal((await oidcOAuth(gateway(mock, { issuer: `${mock.issuer}/` }), fetch, FAST).login(noop)).access, "A");
});

test("expiry comes from the bearer's own exp, even when it is already past, and an access JWT's exp is honoured", async () => {
  const mock = await idp();
  const past = Math.floor(Date.now() / 1000) - 600;
  mock.tokenReplies = [[200, { access_token: "A", id_token: jwt({ sub: "s", exp: past }), refresh_token: "R", expires_in: 3600 }]];
  const idCred = await oidcOAuth(gateway(mock, { token: "id" }), fetch, FAST).login(noop);
  assert.equal(idCred.expires, past * 1000);
  const soon = Math.floor(Date.now() / 1000) + 600;
  mock.tokenReplies = [[200, { access_token: jwt({ exp: soon }), refresh_token: "R", expires_in: 86_400 }]];
  const accessCred = await oidcOAuth(gateway(mock), fetch, FAST).login(noop);
  assert.ok(accessCred.expires <= soon * 1000 && accessCred.expires > soon * 1000 - 120_000);
});

test("token: id with no id_token on refresh asks for a new sign-in", async () => {
  const mock = await idp();
  mock.refreshReplies = [[200, { access_token: "A", expires_in: 3600 }]];
  await assert.rejects(oidcOAuth(gateway(mock, { token: "id" }), fetch, FAST).refreshToken(stored(mock, { tokenKind: "id" }), never()), /no ID token on refresh; sign in again to Corp SSO/);
});
