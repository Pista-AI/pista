import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { test } from "node:test";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { applyNetwork, describeNetwork, redactProxy, telemetryEnv } from "./network.ts";
import { loadManagedPolicy, type PolicyIo } from "./policy.ts";

const FILE = "/p/policy.json";
const io = (files: Record<string, string>): PolicyIo => ({ exists: (p) => p in files, read: (p) => files[p]! });
const load = (body: unknown, env: NodeJS.ProcessEnv = { PISTA_POLICY_FILE: FILE }) => loadManagedPolicy(env, "linux", io({ [FILE]: typeof body === "string" ? body : JSON.stringify(body) }));
const listen = (server: Server) => new Promise<number>((done) => server.listen(0, "127.0.0.1", () => done((server.address() as AddressInfo).port)));

test("network and telemetry blocks load", () => {
  const out = load({ version: 1, network: { proxy: "http://u:p@proxy.corp:3128", noProxy: ["localhost", ".corp"], caCertFiles: ["/ca.pem"], useSystemCa: true }, telemetry: { piTelemetry: false, versionCheck: false } });
  assert.equal(out.failure, undefined);
  assert.deepEqual(out.policy?.network, { proxy: "http://u:p@proxy.corp:3128", noProxy: ["localhost", ".corp"], caCertFiles: ["/ca.pem"], useSystemCa: true });
  assert.deepEqual(out.policy?.telemetry, { piTelemetry: false, versionCheck: false });
});

test("a malformed network or telemetry block stops the host", () => {
  for (const bad of [{ network: { proxy: "ftp://x" } }, { network: { proxy: "nope" } }, { network: { noProxy: "a" } }, { network: { caCertFiles: [1] } }, { network: { useSystemCa: "yes" } }, { network: { extra: 1 } }, { network: [] }, { telemetry: { piTelemetry: "no" } }, { telemetry: { other: true } }]) {
    const out = load({ version: 1, ...bad });
    assert.equal(out.policy, null, JSON.stringify(bad));
    assert.match(out.failure ?? "", /network|telemetry/, JSON.stringify(bad));
  }
});

test("fail closed: an existing but broken file is a failure, a missing one only when required", () => {
  assert.match(load("{ not json").failure ?? "", /invalid JSON in/);
  assert.match(load({ version: 2 }).failure ?? "", /"version" must be 1/);
  assert.match(load([]).failure ?? "", /"version" must be 1/);
  assert.equal(load({ version: 1 }).failure, undefined);
  const missing = (env: NodeJS.ProcessEnv) => loadManagedPolicy(env, "linux", io({}));
  assert.equal(missing({}).failure, undefined);
  assert.equal(missing({ PISTA_POLICY_FILE: FILE }).failure, undefined);
  assert.match(missing({ PISTA_REQUIRE_POLICY: "1" }).failure ?? "", /PISTA_REQUIRE_POLICY=1.*\/etc\/pista\/managed-policy\.json/);
  assert.match(missing({ PISTA_REQUIRE_POLICY: "1", PISTA_POLICY_FILE: FILE }).failure ?? "", /PISTA_REQUIRE_POLICY=1/);
  assert.equal(loadManagedPolicy({ PISTA_REQUIRE_POLICY: "1" }, "linux", io({ "/etc/pista/managed-policy.json": '{"version":1}' })).failure, undefined);
});

test("proxy credentials are redacted", () => {
  assert.equal(redactProxy("http://alice:s3cret@proxy.corp:3128"), "http://***@proxy.corp:3128");
  assert.equal(redactProxy("http://proxy.corp:3128/"), "http://proxy.corp:3128");
  assert.equal(redactProxy("not a url s3cret"), "<invalid proxy URL>");
  const line = describeNetwork({ proxy: "http://alice:s3cret@proxy.corp:3128", noProxy: "", caFiles: 0, systemCa: false });
  assert.ok(!line.includes("s3cret") && !line.includes("alice"));
});

test("telemetry policy maps to Pi's environment switches", () => {
  assert.deepEqual(telemetryEnv(undefined), {});
  assert.deepEqual(telemetryEnv({ piTelemetry: true, versionCheck: true }), {});
  assert.deepEqual(telemetryEnv({ piTelemetry: false, versionCheck: false }), { PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" });
});

test("an unreadable CA file is an error", () => {
  assert.throws(() => applyNetwork({ caCertFiles: ["/nonexistent/ca.pem"] }, {}), /cannot read \/nonexistent\/ca\.pem/);
});

test("loopback is always direct, even with a dead proxy", async () => {
  const local = createServer((_req, res) => res.end("local"));
  const port = await listen(local);
  const previous = getGlobalDispatcher();
  const env: NodeJS.ProcessEnv = {};
  try {
    const applied = applyNetwork({ proxy: "http://127.0.0.1:1", noProxy: [".corp"] }, env);
    assert.match(applied.noProxy, /\.corp.*127\.0\.0\.1.*localhost/);
    assert.equal(env.NO_PROXY, applied.noProxy);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "local");
  } finally {
    setGlobalDispatcher(previous);
    local.close();
    local.closeAllConnections();
  }
});

test("fetch goes through the proxy from the policy, which wins over the environment", async () => {
  const seen: string[] = [];
  const upstream = createServer((_req, res) => res.end("upstream"));
  const upstreamPort = await listen(upstream);
  const proxy = createServer((req: IncomingMessage, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.end("via-proxy");
  });
  // Tunnelled requests (CONNECT) are wired to the local upstream whatever host was asked for.
  proxy.on("connect", (req, client) => {
    seen.push(`CONNECT ${req.url}`);
    const onward = connect(upstreamPort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      onward.pipe(client);
      client.pipe(onward);
    });
    onward.on("error", () => client.destroy());
    client.on("error", () => onward.destroy());
  });
  const proxyPort = await listen(proxy);
  const previous = getGlobalDispatcher();
  const env: NodeJS.ProcessEnv = { HTTPS_PROXY: "http://wrong.invalid:1" };
  try {
    const applied = applyNetwork({ proxy: `http://127.0.0.1:${proxyPort}` }, env);
    assert.equal(applied.proxy, `http://127.0.0.1:${proxyPort}`);
    assert.equal(env.HTTP_PROXY, `http://127.0.0.1:${proxyPort}`);
    const body = await (await fetch("http://corp-service.test:8080/ping")).text();
    assert.ok(body === "via-proxy" || body === "upstream", body);
    assert.ok(seen.some((line) => line.includes("corp-service.test:8080")), seen.join(" | "));
  } finally {
    setGlobalDispatcher(previous);
    proxy.close();
    upstream.close();
    proxy.closeAllConnections();
    upstream.closeAllConnections();
  }
});
