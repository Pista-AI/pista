import assert from "node:assert/strict";
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

test("name only: different names are never merged, identical duplicates take the first", () => {
  assert.equal((resolveLocator(els, { name: "Download invoice" }) as { reason: string }).reason, "ambiguous");
  assert.deepEqual(resolveLocator(els, { role: "link", name: "Help" }), { target: "e4" });
});

test("a role mismatch falls back to the exact name, but never to a fuzzy text match", () => {
  assert.deepEqual(resolveLocator(els, { role: "button", name: "Billing" }), { target: "e1" });
  assert.equal((resolveLocator(els, { role: "link", text: "Get PDF" }) as { reason: string }).reason, "not-found");
  assert.deepEqual(resolveLocator(els, { role: "button", text: "get pdf" }), { target: "e6" });
});

test("fallbacks are tried in order, a selector only when the page has it", () => {
  assert.deepEqual(resolveLocator(els, { name: "Invoices" }, [{ selector: "#gone" }, { role: "link", name: "Billing" }]), { target: "e1" });
  assert.deepEqual(resolveLocator(els, { name: "Invoices" }, [{ selector: "#dl" }], new Set(["#dl"])), { target: "#dl" });
  assert.equal((resolveLocator(els, { name: "Invoices" }, [{ selector: "#gone" }]) as { reason: string }).reason, "not-found");
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

test("a blocked start page hands off before anything is opened, and a declined step stops", async () => {
  let opened = 0;
  const driver = {
    navigate: async (url: string) => (opened++, { url, title: "", loading: false }),
    state: async () => ({ url: "about:blank", title: "", loading: false }),
    evaluate: async () => {
      throw new Error("no page");
    },
    input: async () => false,
  } as unknown as BrowserDriver;
  const blocked = await runReplay({ startUrl: "https://evil.test/", steps: [] }, { driver, domainRules: { deniedDomains: ["evil.test"] }, downloadRoot: "/nonexistent", downloadPath: "a.pdf" });
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.reason, "blocked");
  assert.equal(!blocked.ok && blocked.failedIndex, 0);
  assert.equal(opened, 0);
  const declined = await runReplay(
    { startUrl: "https://ok.test/", steps: [{ kind: "download", url: "https://ok.test/a.pdf" }] },
    { driver, downloadRoot: "/nonexistent", downloadPath: "a.pdf", approve: async () => false },
  );
  assert.equal(!declined.ok && declined.reason, "declined");
  assert.equal(!declined.ok && declined.failedIndex, 1);
});
