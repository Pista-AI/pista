import test from "node:test";
import assert from "node:assert/strict";
import { hostOf, validateLoginInput } from "../src/focused/saved-logins.ts";

const ok = { label: "Slack", loginUrl: "https://app.slack.com/signin", username: "ann", password: "pw" };

test("accepts a complete https login", () => assert.equal(validateLoginInput(ok), null));
test("accepts http on localhost", () => {
  assert.equal(validateLoginInput({ ...ok, loginUrl: "http://127.0.0.1:8765/login.html" }), null);
  assert.equal(validateLoginInput({ ...ok, loginUrl: "http://localhost:3000/" }), null);
});
test("rejects empty fields", () => {
  for (const k of ["label", "loginUrl", "username", "password"] as const) assert.ok(validateLoginInput({ ...ok, [k]: "" }), k);
  assert.ok(validateLoginInput({ ...ok, label: "   " }));
});
test("rejects http on a real host", () => assert.match(validateLoginInput({ ...ok, loginUrl: "http://example.com" })!, /https/));
test("rejects bad URL and userinfo", () => {
  assert.ok(validateLoginInput({ ...ok, loginUrl: "not a url" }));
  assert.match(validateLoginInput({ ...ok, loginUrl: "https://bob:pw@example.com" })!, /out of the address/);
});
test("hostOf extracts the host", () => {
  assert.equal(hostOf("https://app.slack.com"), "app.slack.com");
  assert.equal(hostOf("http://127.0.0.1:8765"), "127.0.0.1:8765");
  assert.equal(hostOf("weird"), "weird");
});

test("local hosts in other forms are accepted", () => {
  assert.equal(validateLoginInput({ ...ok, loginUrl: "http://[::1]:3000" }), null);
  assert.equal(validateLoginInput({ ...ok, loginUrl: "HTTP://LOCALHOST" }), null);
});
test("other schemes and blank username are rejected", () => {
  assert.ok(validateLoginInput({ ...ok, loginUrl: "ftp://example.com" }));
  assert.ok(validateLoginInput({ ...ok, loginUrl: "javascript:alert(1)" }));
  assert.ok(validateLoginInput({ ...ok, username: "   " }));
});
test("hostOf keeps ipv6 port and drops default port", () => {
  assert.equal(hostOf("http://[::1]:3000"), "[::1]:3000");
  assert.equal(hostOf("https://example.com:443"), "example.com");
});
