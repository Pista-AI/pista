import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BrowserDriver } from "../src/driver.ts";
import { expectationMet, pollUntil, resolveLocator, runReplay } from "../src/replay.ts";

const els = [
  { ref: "e1", role: "link", name: "Billing" },
  { ref: "e2", role: "button", name: "Download  invoice" },
  { ref: "e3", role: "link", name: "Download invoice" },
  { ref: "e4", role: "link", name: "Help" },
  { ref: "e5", role: "link", name: "Help" },
  { ref: "e6", role: "button", name: "Get PDF for January" },
];

test("exact role + name wins over a same-named element of another role", () => {
  assert.deepEqual(resolveLocator(els, { role: "link", name: "download invoice" }), { target: "e3" });
});

test("several matches in a tier are ambiguous, also identical ones without a known address", () => {
  assert.equal((resolveLocator(els, { name: "Download invoice" }) as { reason: string }).reason, "ambiguous");
  assert.equal((resolveLocator(els, { role: "link", name: "Help" }) as { reason: string }).reason, "ambiguous");
});

test("a role mismatch falls back to the exact name, but never to a fuzzy text match", () => {
  assert.deepEqual(resolveLocator(els, { role: "button", name: "Billing" }), { target: "e1" });
  assert.equal((resolveLocator(els, { role: "link", text: "Get PDF" }) as { reason: string }).reason, "not-found");
  assert.deepEqual(resolveLocator(els, { role: "button", text: "get pdf" }), { target: "e6" });
});

test("duplicate per-row links are ambiguous unless they lead to the same address", () => {
  const rows = [{ ref: "e1", role: "link", name: "Download", href: "https://x.test/1.pdf" }, { ref: "e2", role: "link", name: "Download", href: "https://x.test/2.pdf" }];
  assert.equal((resolveLocator(rows, { role: "link", name: "Download" }) as { reason: string }).reason, "ambiguous");
  assert.deepEqual(resolveLocator([rows[0]!, { ...rows[1]!, href: rows[0]!.href }], { role: "link", name: "Download" }), { target: "e1" });
  const buttons = [{ ref: "e1", role: "button", name: "Go" }, { ref: "e2", role: "button", name: "Go" }];
  assert.equal((resolveLocator(buttons, { role: "button", name: "Go" }) as { reason: string }).reason, "ambiguous");
});

test("fallbacks are tried in order, a selector only when the page has it", () => {
  assert.deepEqual(resolveLocator(els, { name: "Invoices" }, [{ selector: "#gone" }, { role: "link", name: "Billing" }]), { target: "e1" });
  assert.deepEqual(resolveLocator(els, { name: "Invoices" }, [{ selector: "#dl" }], new Map([["#dl", 1]])), { target: "#dl" });
  assert.equal((resolveLocator(els, { name: "Invoices" }, [{ selector: "#gone" }]) as { reason: string }).reason, "not-found");
  assert.equal((resolveLocator(els, { selector: ".row a" }, [], new Map([[".row a", 2]])) as { reason: string }).reason, "ambiguous");
  assert.equal((resolveLocator(els, { selector: "e3" }, [], new Map([["e3", 1]])) as { reason: string }).reason, "not-found");
});

/** A page whose URL changes after `after` reads of state(), with a fake clock. */
function fakePage(after: number, body = "") {
  let reads = 0;
  let clock = 0;
  const driver = {
    state: async () => ({ url: ++reads > after ? "https://x.test/billing" : "https://x.test/home", title: "", loading: false }),
    evaluate: async () => body,
  } as unknown as BrowserDriver;
  return { driver, now: () => clock, sleep: async (ms: number) => void (clock += ms) };
}

test("expectations are polled until they hold, and give up at the timeout", async () => {
  const p = fakePage(3);
  assert.equal(await pollUntil(() => expectationMet(p.driver, { urlIncludes: "/billing" }), 10_000, 250, p.now, p.sleep), true);
  assert.equal(p.now(), 750);
  const q = fakePage(1000, "Welcome   BACK");
  assert.equal(await pollUntil(() => expectationMet(q.driver, { text: "welcome back" }), 1000, 250, q.now, q.sleep), true);
  assert.equal(await pollUntil(() => expectationMet(q.driver, { urlIncludes: "/billing" }), 1000, 250, q.now, q.sleep), false);
});

/** A scriptless page at `url` (navigate moves it there, `redirect` overrides where it lands), with optional saved logins and a download writer. */
function fakeDriver(o: { redirect?: string; logins?: { id: string; label: string; origin: string }[]; file?: { body: string; contentType?: string } } = {}) {
  let url = "about:blank";
  let opened = 0;
  const driver = {
    navigate: async (to: string) => (opened++, (url = o.redirect ?? to), { url, title: "", loading: false }),
    state: async () => ({ url, title: "", loading: false }),
    evaluate: async () => "",
    input: async () => false,
    ...(o.logins ? { loginList: async () => o.logins!, loginFill: async () => ({ ok: true, note: "Signed in." }) } : {}),
    ...(o.file ? { download: async ({ path }: { path: string }) => (writeFileSync(path, o.file!.body), { bytes: o.file!.body.length, contentType: o.file!.contentType }) } : {}),
  } as unknown as BrowserDriver;
  return { driver, opened: () => opened };
}
const site = (u: string) => new URL(u).hostname === "ok.test";
const base = { allowUrl: site, downloadRoot: "/nonexistent", downloadPath: "a.pdf" };
const reasonOf = (r: Awaited<ReturnType<typeof runReplay>>) => (r.ok ? "ok" : `${r.failedIndex}:${r.reason}`);

test("blocked addresses: domain rules, non-http(s) schemes, other sites and off-site redirects", async () => {
  const f = fakeDriver();
  assert.equal(reasonOf(await runReplay({ startUrl: "https://ok.test/", steps: [] }, { ...base, driver: f.driver, domainRules: { deniedDomains: ["ok.test"] } })), "0:blocked");
  assert.equal(reasonOf(await runReplay({ startUrl: "https://other.test/", steps: [] }, { ...base, driver: f.driver })), "0:blocked");
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x"]) {
    assert.equal(reasonOf(await runReplay({ startUrl: "https://ok.test/", steps: [{ kind: "navigate", url }] }, { ...base, driver: f.driver })), "1:blocked");
    assert.equal(reasonOf(await runReplay({ startUrl: "https://ok.test/", steps: [{ kind: "download", url }] }, { ...base, driver: f.driver })), "1:blocked");
  }
  assert.equal(f.opened(), 6); // only the allowed start pages were opened
  const r = await runReplay({ startUrl: "https://ok.test/", steps: [] }, { ...base, driver: fakeDriver({ redirect: "https://other.test/x" }).driver });
  assert.equal(reasonOf(r), "0:blocked");
  assert.equal(!r.ok && r.snapshot, "");
});

test("declined and aborted steps stop", async () => {
  const { driver } = fakeDriver();
  const steps = [{ kind: "download" as const, url: "https://ok.test/a.pdf" }];
  assert.equal(reasonOf(await runReplay({ startUrl: "https://ok.test/", steps }, { ...base, driver, approve: async () => false })), "1:declined");
  assert.equal(reasonOf(await runReplay({ startUrl: "https://ok.test/", steps }, { ...base, driver, signal: AbortSignal.abort() })), "0:aborted");
});

test("sign-in needs exactly one saved login for the origin, on that origin", async () => {
  const login = (origin: string, id = "a") => ({ id, label: id, origin });
  const run = (logins: { id: string; label: string; origin: string }[], start = "https://ok.test/login") =>
    runReplay({ startUrl: start, steps: [{ kind: "signIn", origin: "https://ok.test" }] }, { ...base, driver: fakeDriver({ logins }).driver });
  assert.equal(reasonOf(await run([login("https://other.test")])), "1:sign-in-needed");
  assert.equal(reasonOf(await run([login("https://ok.test"), login("https://ok.test", "b")])), "1:sign-in-needed");
  assert.equal(reasonOf(await run([login("https://ok.test")], "https://www.ok.test/login")), "0:blocked");
  const wrong = await runReplay({ startUrl: "https://ok.test/", steps: [{ kind: "signIn", origin: "https://sso.ok.test" }] }, { ...base, allowUrl: (u) => u.includes("ok.test"), driver: fakeDriver({ logins: [login("https://sso.ok.test")] }).driver });
  assert.equal(!wrong.ok && wrong.detail, "The page is not on https://sso.ok.test.");
});

test("a download that is not the expected file never replaces the good one", async () => {
  const root = mkdtempSync(join(tmpdir(), "replay-"));
  writeFileSync(join(root, "a.pdf"), "%PDF-1.4 good");
  const steps = [{ kind: "download" as const, url: "https://ok.test/a.pdf", fileType: "pdf" }];
  const run = (file: { body: string; contentType?: string }, fileType?: string) =>
    runReplay({ startUrl: "https://ok.test/", steps: [{ ...steps[0]!, fileType }] }, { ...base, downloadRoot: root, overwrite: true, driver: fakeDriver({ file }).driver });
  assert.equal(reasonOf(await run({ body: "<html>sign in</html>", contentType: "text/html" }, "pdf")), "1:error");
  assert.equal(reasonOf(await run({ body: "<html>sign in</html>", contentType: "text/html" })), "1:error");
  assert.equal(reasonOf(await run({ body: "not a pdf" }, "pdf")), "1:error");
  assert.equal(readFileSync(join(root, "a.pdf"), "latin1"), "%PDF-1.4 good");
  assert.equal(reasonOf(await run({ body: "not a pdf", contentType: "application/octet-stream" }, "pdf")), "1:error");
  assert.equal(readFileSync(join(root, "a.pdf"), "latin1"), "%PDF-1.4 good");
  assert.equal(reasonOf(await run({ body: "%PDF-1.6 binary", contentType: "binary/octet-stream" }, "pdf")), "ok");
  assert.equal(reasonOf(await run({ body: "%PDF-1.7 new" }, "pdf")), "ok");
  assert.equal(readFileSync(join(root, "a.pdf"), "latin1"), "%PDF-1.7 new");
});

test("a download that lands after the deadline is discarded and the old file stays", async () => {
  const root = mkdtempSync(join(tmpdir(), "replay-"));
  writeFileSync(join(root, "a.pdf"), "%PDF-1.4 good");
  let landed!: () => void;
  const late = new Promise<void>((r) => (landed = r));
  const f = fakeDriver();
  (f.driver as { download?: unknown }).download = async ({ path }: { path: string }) => {
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(path, "%PDF-1.7 late");
    setTimeout(landed, 0);
    return { bytes: 13, contentType: "application/pdf" };
  };
  const r = await runReplay({ startUrl: "https://ok.test/", steps: [{ kind: "download", url: "https://ok.test/a.pdf", fileType: "pdf" }] }, { ...base, downloadRoot: root, overwrite: true, downloadTimeoutMs: 10, driver: f.driver });
  assert.equal(reasonOf(r), "1:error");
  await late;
  assert.equal(readFileSync(join(root, "a.pdf"), "latin1"), "%PDF-1.4 good");
  assert.deepEqual(readdirSync(root), ["a.pdf"]);
});

test("a click that leads off the site hands off as blocked", async () => {
  let url = "about:blank";
  const driver = {
    navigate: async (to: string) => ((url = to), { url, title: "", loading: false }),
    state: async () => ({ url, title: "", loading: false }),
    evaluate: async (script: string) => {
      if (script.includes("pageSnapshot")) return { lines: [], count: 1, omitted: 0, scroll: { y: 0, height: 1, viewport: 1 }, elements: [{ ref: "e1", role: "link", name: "Billing" }] };
      if (script.includes("pagePrepare")) return { kind: "link", name: "Billing", label: 'link "Billing"', x: 1, y: 1 };
      return "";
    },
    input: async (e: { type: string }) => (e.type === "click" && (url = "https://other.test/phish"), true),
  } as unknown as BrowserDriver;
  const r = await runReplay({ startUrl: "https://ok.test/", steps: [{ kind: "click", target: { role: "link", name: "Billing" } }] }, { ...base, driver });
  assert.equal(reasonOf(r), "1:blocked");
  assert.equal(!r.ok && r.snapshot, "");
});

test("playbook values reach page script only as escaped argument literals", async () => {
  const selector = "a[href=\"</script>\"] \\ 'x' `y` \u2028\u2029 > b/c";
  const name = "Pay \"now\" `x` 'y' </script>";
  const scripts: string[] = [];
  const driver = {
    evaluate: async (script: string) => {
      if (script.includes("pageSnapshot")) return { lines: [], count: 0, omitted: 0, scroll: { y: 0, height: 1, viewport: 1 }, elements: [] };
      scripts.push(script);
      return 0;
    },
  } as unknown as BrowserDriver;
  await expectationMet(driver, { element: { name, selector } });
  const script = scripts.find((s) => s.includes("querySelectorAll"));
  assert.ok(script);
  assert.equal(script.includes("</script>"), false);
  assert.equal(/[\u2028\u2029]/.test(script), false);
  let seen: unknown;
  const fakeDocument = { querySelectorAll: (s: string) => ((seen = s), []) };
  new Function("document", "window", `return ${script}`)(fakeDocument, {});
  assert.equal(seen, selector);
});
