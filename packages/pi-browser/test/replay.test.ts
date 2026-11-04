import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BrowserDriver } from "../src/driver.ts";
import { expectationMet, pickRow, pollUntil, resolveAll, resolveLocator, runReplay, verifySingleRow } from "../src/replay.ts";
import { rowTextOf } from "../src/row-match.ts";

test("a lone download is acted on only when its row shows exactly the invoice date", () => {
  const inv = { date: "2026-10-03" };
  assert.deepEqual(verifySingleRow("3 Oct 2026 49.00 EUR PDF", inv), { ok: true });
  const other = verifySingleRow("3 Sep 2026 49.00 EUR PDF", inv);
  assert.equal(other.ok, false);
  assert.ok(!other.ok && other.detail.includes("2026-10-03") && !other.detail.includes("Sep"));
  assert.equal(verifySingleRow("PDF", inv).ok, false);
  assert.equal(verifySingleRow("", inv).ok, false);
  assert.equal(verifySingleRow("3 Oct 2026 and 3 Nov 2026 PDF", inv).ok, false);
});

test("an amount shown in the row has to match too, and a row without one is judged by its date", () => {
  const inv = { date: "2026-10-03", amount: 49, currency: "EUR" };
  assert.equal(verifySingleRow("3 Oct 2026 49.00 EUR PDF", inv).ok, true);
  assert.equal(verifySingleRow("3 Oct 2026 12.00 EUR PDF", inv).ok, false);
  assert.equal(verifySingleRow("3 Oct 2026 PDF", inv).ok, true);
});

test("the row text of a lone element is the nearest level with one date, and never one above a list", () => {
  assert.equal(rowTextOf(["PDF", "3 Sep 2026 PDF"]), "3 Sep 2026 PDF");
  assert.equal(rowTextOf(["PDF", "Invoices PDF"]), "");
  assert.equal(rowTextOf(["PDF", "3 Sep 2026 PDF 3 Oct 2026", "3 Nov 2026 PDF"]), "");
  assert.equal(rowTextOf(null), "");
});

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

test("row selection: one match is chosen, none and several are handoffs that name the invoice but not the rows", () => {
  const links = [1, 2, 3, 4].map((n) => ({ ref: `e${n}`, role: "link", name: "Download invoice", href: `https://x.test/${n}.pdf` }));
  const refs = resolveAll(links, { role: "link", name: "Download invoice", row: { match: ["date"] } });
  assert.deepEqual(refs, ["e1", "e2", "e3", "e4"]);
  const texts = ["3 Sep 2026 49,00 EUR", "2026-10-03 49,00 EUR", "3 nov. 2026 12,00 EUR", "3 nov. 2026 99,00 EUR"];
  assert.deepEqual(pickRow(refs, texts, { date: "2026-10-04" }, ["date"]), { target: "e2" });
  assert.deepEqual(pickRow(refs, texts, { date: "2026-11-03", amount: 99, currency: "EUR" }, ["date", "amount"]), { target: "e4" });
  const many = pickRow(refs, texts, { date: "2026-11-03", amount: 99 }, ["date"]) as { reason: string; detail: string };
  assert.equal(many.reason, "row-ambiguous");
  assert.ok(many.detail.startsWith("2 rows") && many.detail.includes("2026-11-03") && !many.detail.includes("nov."));
  const none = pickRow(refs, texts, { date: "2026-12-20", amount: 5.5, currency: "SEK" }, ["date", "amount"]) as { reason: string; detail: string };
  assert.equal(none.reason, "row-not-found");
  assert.ok(none.detail.includes("2026-12-20") && none.detail.includes("5.5 SEK"));
});

test("a row step without an invoice hands off as needs-invoice", async () => {
  const driver = { state: async () => ({ url: "https://x.test/list", title: "", loading: false }), navigate: async () => ({}), evaluate: async () => { throw new Error("no page"); } } as unknown as BrowserDriver;
  const dir = mkdtempSync(join(tmpdir(), "row-"));
  const r = await runReplay({ startUrl: "https://x.test/list", steps: [{ kind: "download", target: { role: "link", name: "Download", row: { match: ["date"] } } }] }, { driver, allowUrl: () => true, downloadRoot: dir, downloadPath: "a.pdf" });
  assert.equal(!r.ok && r.reason, "needs-invoice");
});

test("pickRow hands off when a row is unreadable, identical to another, or holds many dates", () => {
  const refs = ["e1", "e2"];
  const inv = { date: "2026-10-04" };
  assert.equal((pickRow(refs, ["2026-10-03", null], inv, ["date"]) as { reason: string }).reason, "row-ambiguous");
  assert.equal((pickRow(refs, ["2026-10-03", "2026-10-03"], inv, ["date"]) as { reason: string }).reason, "row-ambiguous");
  assert.equal((pickRow(refs, ["1 Jan 2026 1 Feb 2026 1 Mar 2026 2026-10-03", "x"], inv, ["date"]) as { reason: string }).reason, "row-ambiguous");
  assert.deepEqual(pickRow(refs, ["2026-10-03", "2026-09-01"], inv, ["date"]), { target: "e1" });
});

test("a truncated snapshot hands off as row-ambiguous instead of choosing among a partial list", async () => {
  const snap = { lines: [], count: 1, omitted: 40, scroll: { y: 0, height: 0, viewport: 0 }, elements: [{ ref: "e1", role: "link", name: "Download" }] };
  const driver = { state: async () => ({ url: "https://x.test/list", title: "", loading: false }), navigate: async () => ({}), evaluate: async () => snap } as unknown as BrowserDriver;
  const dir = mkdtempSync(join(tmpdir(), "row-"));
  const r = await runReplay({ startUrl: "https://x.test/list", steps: [{ kind: "download", target: { role: "link", name: "Download", row: { match: ["date"] } } }] }, { driver, allowUrl: () => true, downloadRoot: dir, downloadPath: "a.pdf", invoice: { date: "2026-10-04" } });
  assert.equal(!r.ok && r.reason, "row-ambiguous");
  assert.ok(!r.ok && r.detail.includes("2026-10-04"));
});

test("a period step needs the invoice and hands off when no month, or several, cover its date", async () => {
  const tab = (ref: string, name: string) => ({ ref, role: "tab", name });
  const run = async (names: string[], invoice?: { date: string }) => {
    const snap = { lines: [], count: 1, omitted: 0, scroll: { y: 0, height: 0, viewport: 0 }, elements: [...names.map((n, i) => tab(`e${i + 1}`, n)), { ref: "e9", role: "tab", name: "Settings" }] };
    const driver = { state: async () => ({ url: "https://x.test/list", title: "", loading: false }), navigate: async () => ({}), evaluate: async () => snap } as unknown as BrowserDriver;
    const dir = mkdtempSync(join(tmpdir(), "period-"));
    const step = { kind: "click" as const, target: { role: "tab", period: true } };
    const r = await runReplay({ startUrl: "https://x.test/list", steps: [step, { kind: "download", url: "https://x.test/a.pdf" }] }, { driver, allowUrl: () => true, downloadRoot: dir, downloadPath: "a.pdf", ...(invoice ? { invoice } : {}) });
    return r.ok ? "ok" : r.reason;
  };
  assert.equal(await run(["September 2026", "October 2026"]), "needs-invoice");
  assert.equal(await run(["September 2026", "October 2026"], { date: "2026-12-04" }), "row-not-found");
  assert.equal(await run(["October 2026", "Oct 2026"], { date: "2026-10-04" }), "row-ambiguous");
});
