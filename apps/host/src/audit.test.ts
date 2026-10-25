import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { auditLogsUrl, auditSection, resolveAuditHeaders } from "./audit-policy.ts";
import { auditHash, createAudit, createOtlpAudit, noopAudit } from "./audit.ts";

const parse = (raw: unknown) => {
  const problems: string[] = [];
  return { out: auditSection(raw, problems), problems };
};

test("a valid audit block parses and the opt-ins default to off", () => {
  const { out, problems } = parse({ otlpEndpoint: "https://otel.corp:4318", headersEnv: { authorization: "OTEL_TOKEN" }, resourceAttributes: { "deployment.environment": "prod" } });
  assert.deepEqual(problems, []);
  assert.equal(out.otlpEndpoint, "https://otel.corp:4318");
  assert.equal(out.includePrompts, undefined);
  assert.equal(out.includeToolArgs, undefined);
  assert.equal(createOtlpAudit({ policy: out, version: "1", warn() {} }).includePrompts, false);
});

test("grpc, a non-URL, a missing endpoint and unknown keys are rejected", () => {
  for (const bad of [{ otlpEndpoint: "https://x", protocol: "grpc" }, { otlpEndpoint: "not a url" }, { otlpEndpoint: "ftp://x" }, {}, { otlpEndpoint: "https://x", extra: 1 }, { otlpEndpoint: "https://x", headersEnv: { a: 1 } }, { otlpEndpoint: "https://u:p@x" }, { otlpEndpoint: "https://x", headersEnv: { "bad name": "V" } }, []]) {
    assert.ok(parse(bad).problems.length > 0, JSON.stringify(bad));
  }
  assert.match(parse({ otlpEndpoint: "https://x", protocol: "grpc" }).problems.join(), /grpc/);
});

test("headers resolve from the environment; a missing variable is warned and omitted", () => {
  const warnings: string[] = [];
  const headers = resolveAuditHeaders({ authorization: "A_TOKEN", "x-other": "NOT_SET" }, { A_TOKEN: "Bearer s3cret" }, (w) => warnings.push(w));
  assert.deepEqual(headers, { authorization: "Bearer s3cret" });
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /s3cret/);
});

async function receiver() {
  const requests: { url?: string; headers: IncomingMessage["headers"]; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ url: req.url, headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { requests, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test("the OTLP sink posts session events to /v1/logs with resource attributes and the env header", async () => {
  const rx = await receiver();
  try {
    const sink = createAudit({ version: 1, locked: {}, defaults: {}, audit: { otlpEndpoint: rx.endpoint, headersEnv: { authorization: "AUDIT_TEST_TOKEN" }, resourceAttributes: { "deployment.environment": "test" } } }, {
      version: "9.9.9",
      env: { AUDIT_TEST_TOKEN: "Bearer topsecret-value" },
      subject: () => "user-123",
      warn() {},
    });
    sink.emit("pista.session.start", { "session.id": "t1", "project.id": "p1", "cwd.hash": auditHash("/work/secret-project"), "session.restored": false, skipped: undefined });
    sink.emit("pista.session.end", { "session.id": "t1", "session.message_count": 3 });
    await sink.dispose();
    assert.equal(rx.requests.length, 1);
    const [req] = rx.requests;
    assert.equal(req.url, "/v1/logs");
    assert.equal(req.headers.authorization, "Bearer topsecret-value");
    assert.equal(req.headers["content-type"], "application/json");
    const json = JSON.parse(req.body);
    const rl = json.resourceLogs[0];
    const res = Object.fromEntries(rl.resource.attributes.map((a: { key: string; value: { stringValue: string } }) => [a.key, a.value.stringValue]));
    assert.equal(res["service.name"], "pista");
    assert.equal(res["service.version"], "9.9.9");
    assert.equal(res["deployment.environment"], "test");
    assert.ok(res["host.name"] && res["os.type"]);
    assert.equal(rl.scopeLogs[0].scope.name, "pista.audit");
    const records = rl.scopeLogs[0].logRecords;
    assert.deepEqual(records.map((r: { attributes: { key: string; value: { stringValue: string } }[] }) => r.attributes.find((a) => a.key === "event.name")!.value.stringValue), ["pista.session.start", "pista.session.end"]);
    assert.match(records[0].timeUnixNano, /^\d{19}$/);
    const attrs = Object.fromEntries(records[0].attributes.map((a: { key: string; value: object }) => [a.key, a.value]));
    assert.deepEqual(attrs["session.id"], { stringValue: "t1" });
    assert.deepEqual(attrs["session.restored"], { boolValue: false });
    assert.deepEqual(attrs["enduser.id"], { stringValue: "user-123" });
    assert.equal(attrs.skipped, undefined);
    assert.deepEqual(Object.fromEntries(records[1].attributes.map((a: { key: string; value: object }) => [a.key, a.value]))["session.message_count"], { intValue: "3" });
    assert.ok(!req.body.includes("topsecret-value"));
    assert.ok(!req.body.includes("/work/secret-project"));
  } finally {
    rx.close();
  }
});

test("a failing collector never throws and records are dropped", async () => {
  const warnings: string[] = [];
  const sink = createOtlpAudit({ policy: { otlpEndpoint: "http://127.0.0.1:1" }, version: "1", warn: (m) => warnings.push(m) });
  sink.emit("pista.session.start", { "session.id": "t1" });
  await sink.flush();
  await sink.dispose();
  assert.ok(warnings.some((w) => /failed/.test(w)));
});

test("the no-op sink makes no requests", async () => {
  const rx = await receiver();
  try {
    const sink = createAudit({ version: 1, locked: {}, defaults: {} }, { version: "1" });
    assert.equal(sink, noopAudit);
    sink.emit("pista.session.start", { "session.id": "t1" });
    await sink.dispose();
    assert.equal(rx.requests.length, 0);
  } finally {
    rx.close();
  }
});

test("the logs URL replaces a trailing /v1/logs, keeps the query and drops the fragment", () => {
  assert.equal(auditLogsUrl("https://o.corp:4318").href, "https://o.corp:4318/v1/logs");
  assert.equal(auditLogsUrl("https://o.corp/v1/logs").href, "https://o.corp/v1/logs");
  assert.equal(auditLogsUrl("https://o.corp/base/?k=1#frag").href, "https://o.corp/base/v1/logs?k=1");
});

test("plain http to a remote host with headers warns; the queue is bounded while a collector hangs", async () => {
  const warnings: string[] = [];
  auditSection({ otlpEndpoint: "http://o.corp", headersEnv: { a: "B" } }, [], warnings);
  assert.equal(warnings.length, 1);
  const rx = createServer(() => {});
  await new Promise<void>((r) => rx.listen(0, "127.0.0.1", r));
  const sink = createOtlpAudit({ policy: { otlpEndpoint: `http://127.0.0.1:${(rx.address() as AddressInfo).port}` }, version: "1", warn() {}, intervalMs: 1e9 });
  for (let i = 0; i < 1500; i++) sink.emit("pista.session.start", { i });
  rx.closeAllConnections();
  rx.close();
});
