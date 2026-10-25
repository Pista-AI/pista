import assert from "node:assert/strict";
import { test } from "node:test";
import { checkUrl, normalizeDomainPattern, type DomainRules } from "../src/domains.ts";
import type { BrowserDriver } from "../src/driver.ts";
import { registerBrowserTools } from "../src/tools.ts";

const allow: DomainRules = { allowedDomains: ["example.com", "*.docs.example.org", "10.0.0.5"] };

test("allowlist: exact, wildcard (subdomains only), everything else denied", () => {
  for (const ok of ["https://example.com/a?b=1", "http://EXAMPLE.com", "https://a.b.docs.example.org/", "http://10.0.0.5:8080/x"]) assert.equal(checkUrl(ok, allow), undefined, ok);
  for (const bad of ["https://docs.example.org/", "https://example.com.evil.com/", "https://notexample.com/", "https://evil.com/"]) assert.ok(checkUrl(bad, allow), bad);
});

test("deny wins over allow, and a denylist alone leaves other hosts open", () => {
  const both: DomainRules = { allowedDomains: ["*.example.com"], deniedDomains: ["admin.example.com"] };
  assert.equal(checkUrl("https://www.example.com/", both), undefined);
  assert.match(checkUrl("https://admin.example.com/", both)!, /denied/);
  assert.equal(checkUrl("https://anything.test/", { deniedDomains: ["*.bad.test"] }), undefined);
  assert.ok(checkUrl("https://x.bad.test/", { deniedDomains: ["*.bad.test"] }));
});

test("normalization: case, trailing dot, IDNA", () => {
  assert.equal(checkUrl("https://Example.COM./x", allow), undefined);
  assert.equal(checkUrl("https://bücher.example/", { allowedDomains: [normalizeDomainPattern("bücher.example")!] }), undefined);
  assert.equal(checkUrl("https://xn--bcher-kva.example/", { allowedDomains: [normalizeDomainPattern("Bücher.example")!] }), undefined);
  assert.equal(normalizeDomainPattern("*.Example.COM."), "*.example.com");
});

test("bypass tricks: userinfo, backslash, IP literals, odd IP forms", () => {
  assert.ok(checkUrl("https://example.com@evil.com/", allow));
  assert.ok(checkUrl("https://evil.com\\@example.com/", allow));
  assert.ok(checkUrl("https://example.com:pw@evil.com/", allow));
  assert.ok(checkUrl("http://[::1]/", allow));
  assert.ok(checkUrl("http://10.0.0.6/", allow));
  assert.equal(checkUrl("http://167772165/", allow), undefined); // decimal form of 10.0.0.5 is the same host
  assert.ok(checkUrl("http://[::1]/", { deniedDomains: ["[::1]"] }));
  assert.ok(checkUrl("http://2130706433/", { deniedDomains: ["127.0.0.1"] }));
});

test("schemes: only http(s) and blank pages once any rule is set", () => {
  for (const url of ["file:///etc/passwd", "data:text/html,hi", "javascript:alert(1)", "blob:https://example.com/x", "ftp://example.com/", "example.com", "/relative"]) assert.ok(checkUrl(url, allow), url);
  assert.ok(checkUrl("data:text/html,hi", { deniedDomains: ["x.test"] }));
  assert.equal(checkUrl("about:blank", allow), undefined);
  assert.equal(checkUrl("file:///x", {}), undefined); // no rules, no checks
  assert.equal(checkUrl("file:///x", { deniedDomains: [] }), undefined);
});

test("pattern validation rejects regex, schemes, ports, paths and bare wildcards", () => {
  for (const bad of ["", "*", "*.", "https://example.com", "example.com/path", "example.com:443", "ex*.com", ".*\\.com", "user@example.com", "*.1.2.3.4", "a b.com"]) assert.equal(normalizeDomainPattern(bad), null, bad);
  assert.equal(normalizeDomainPattern("[::1]"), "[::1]");
});

function fakeDriver(landing: string) {
  const calls: string[] = [];
  let url = "about:blank";
  const driver = {
    navigate: async (u: string) => (calls.push(`navigate ${u}`), (url = u === "about:blank" ? u : landing), { url, title: "", loading: false }),
    state: async () => ({ url, title: "", loading: false }),
    back: async () => {},
    reload: async () => {},
    evaluate: async () => "secret page text",
    input: async () => true,
    screenshot: async () => ({ data: "", mimeType: "image/png" }),
  } as BrowserDriver;
  return { driver, calls, setUrl: (u: string) => (url = u) };
}

function tools(driver: BrowserDriver, rules: DomainRules, blocks: string[] = []) {
  const map = new Map<string, { execute: (...a: unknown[]) => Promise<{ content: { text?: string }[] }> }>();
  registerBrowserTools({ registerTool: (t: { name: string }) => map.set(t.name, t as never), on: () => {} } as never, () => driver, { keepPageViews: 0, domainRules: rules, onDomainBlock: (r) => blocks.push(r) });
  return map;
}

test("browser_navigate refuses a blocked URL without touching the driver", async () => {
  const { driver, calls } = fakeDriver("https://example.com/");
  const blocks: string[] = [];
  await assert.rejects(tools(driver, allow, blocks).get("browser_navigate")!.execute("1", { url: "https://evil.com/" }), /Blocked by your organization's policy: evil\.com is not on the allowed list/);
  assert.deepEqual(calls, []);
  assert.equal(blocks.length, 1);
  const ok = await tools(driver, allow).get("browser_navigate")!.execute("2", { url: "https://example.com/" });
  assert.match(ok.content[0].text!, /example\.com/);
});

test("a redirect to a blocked host resets the browser to about:blank and errors", async () => {
  const { driver, calls } = fakeDriver("https://evil.com/landed");
  await assert.rejects(tools(driver, allow).get("browser_navigate")!.execute("1", { url: "https://example.com/redirects" }), /evil\.com.*reset to a blank page/);
  assert.deepEqual(calls, ["navigate https://example.com/redirects", "navigate about:blank"]);
});

test("a click that navigates to a blocked host is caught when the tool reads the page, and its content is not returned", async () => {
  const { driver, calls, setUrl } = fakeDriver("https://example.com/");
  const t = tools(driver, allow);
  setUrl("https://evil.com/after-click");
  await assert.rejects(t.get("browser_eval")!.execute("1", { script: "document.body.innerText" }), /Blocked by your organization's policy/);
  assert.deepEqual(calls, ["navigate about:blank"]);
});

test("an empty allowedDomains list denies everything", () => {
  assert.ok(checkUrl("https://example.com/", { allowedDomains: [] }));
  assert.equal(checkUrl("about:blank", { allowedDomains: [] }), undefined);
});

test("an unreadable (empty) page URL fails closed after a bounded retry, and recovers if it settles", async () => {
  const { driver, calls, setUrl } = fakeDriver("https://example.com/");
  setUrl("");
  await assert.rejects(tools(driver, allow).get("browser_eval")!.execute("1", { script: "1" }), /could not be verified.*reset/);
  assert.deepEqual(calls, ["navigate about:blank"]);
  let n = 0;
  const flaky = { ...driver, state: async () => ({ url: n++ < 2 ? "" : "https://example.com/", title: "", loading: false }) } as BrowserDriver;
  const out = await tools(flaky, allow).get("browser_eval")!.execute("2", { script: "1" });
  assert.match(out.content[0].text!, /example\.com/);
});

test("eval, input and screenshot refuse to act on a blocked page that was already open", async () => {
  const { driver, calls, setUrl } = fakeDriver("https://example.com/");
  let acted = 0;
  const spy = { ...driver, evaluate: async () => (acted++, "x"), input: async () => (acted++, true), screenshot: async () => (acted++, { data: "", mimeType: "image/png" }) } as BrowserDriver;
  const t = tools(spy, allow);
  for (const [name, args] of [["browser_eval", { script: "1" }], ["browser_screenshot", {}]] as const) {
    setUrl("https://evil.com/");
    await assert.rejects(t.get(name)!.execute("1", args), /Blocked by your organization's policy/);
  }
  const { guardDriver } = await import("../src/domains.ts");
  setUrl("https://evil.com/");
  await assert.rejects(guardDriver(spy, allow).input({ type: "key", key: "a" }), /Blocked/);
  assert.equal(acted, 0);
  assert.ok(calls.length >= 1);
});

test("chrome-error pages: only the exact error page is tolerated, and never as a navigation target", async () => {
  const { driver, setUrl } = fakeDriver("https://example.com/");
  const t = tools(driver, allow);
  await assert.rejects(t.get("browser_navigate")!.execute("1", { url: "chrome-error://chromewebdata/" }), /Blocked/);
  setUrl("chrome-error://chromewebdata/");
  await t.get("browser_eval")!.execute("2", { script: "1" });
  setUrl("chrome-error://evil/");
  await assert.rejects(t.get("browser_eval")!.execute("3", { script: "1" }), /Blocked/);
});

test("without rules the driver is used as is", async () => {
  const { driver } = fakeDriver("https://evil.com/");
  const out = await tools(driver, {}).get("browser_navigate")!.execute("1", { url: "https://evil.com/" });
  assert.match(out.content[0].text!, /evil\.com/);
});
