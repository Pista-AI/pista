import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import type { BrowserDriver } from "../src/driver.ts";
import { scripts } from "../src/page-scripts.ts";
import { evaluateScrubbed, screenshotMasked } from "../src/secrets.ts";
import { registerBrowserTools } from "../src/tools.ts";

/** A just-enough DOM: a flat list of inputs, no layout. The real injected page scripts run against it. */
type FakeField = { tagName: string; type: string; value: string; id: string; attrs: Record<string, string>; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void };
function field(type: string, value: string, attrs: Record<string, string> = {}): FakeField {
  const f: FakeField = {
    tagName: "INPUT", type, value, id: "", attrs: { ...attrs },
    getAttribute: (n) => f.attrs[n] ?? null,
    setAttribute: (n, v) => void (f.attrs[n] = v),
    removeAttribute: (n) => void delete f.attrs[n],
  };
  return f;
}
function fakePage(fields: FakeField[]) {
  const styles: object[] = [];
  const doc = {
    nodeType: 9, head: { appendChild: (s: object) => void styles.push(s) }, documentElement: {},
    createElement: () => {
      const style = { setAttribute() {}, textContent: "", remove: () => void styles.splice(styles.indexOf(style), 1) };
      return style;
    },
    querySelectorAll: (sel: string) => (sel === "*" ? fields : sel.startsWith("style") ? [...styles] : []),
    getElementById: () => null,
  };
  const win: Record<string, unknown> = {};
  return { styles, run: (script: string) => runInNewContext(script, { window: win, document: doc, RegExp, JSON, Array, Set, Document: Object }) };
}

/** A driver over the fake page: page scripts run for real, anything else is the user's script. */
function driver(page: ReturnType<typeof fakePage>, user: () => unknown = () => null, shot: () => Promise<{ data: string; mimeType: string }> = async () => ({ data: "jpg", mimeType: "image/jpeg" })) {
  return {
    state: async () => ({ url: "http://x/", title: "t", loading: false }),
    evaluate: async (script: string) => (script.includes("__pistaSecretMarks") ? page.run(script) : user()),
    screenshot: shot,
  } as unknown as BrowserDriver;
}

test("an autofilled password in an eval result comes back as [redacted]", async () => {
  const page = fakePage([field("password", "hunter2-secret"), field("text", "alice", { name: "user" })]);
  const text = await evaluateScrubbed(driver(page, () => ({ pw: "hunter2-secret", who: "alice", list: ["x hunter2-secret y"], esc: 'a"b' })), "dump()");
  assert.ok(!text.includes("hunter2-secret"));
  assert.match(text, /"pw": "\[redacted\]"/);
  assert.match(text, /alice/); // an ordinary field is untouched
});

test("a value shorter than 4 characters is left alone", async () => {
  assert.match(await evaluateScrubbed(driver(fakePage([field("password", "ab")]), () => "ab"), "x"), /"ab"/);
});

test("a JSON-escaped form of a secret is scrubbed too", async () => {
  const text = await evaluateScrubbed(driver(fakePage([field("password", 'pa"ss"word')]), () => 'pa"ss"word'), "x");
  assert.equal(text, '"[redacted]"');
});

test("a password field toggled to type=text stays secret once a page script has seen it", async () => {
  const pw = field("password", "s3cret-value");
  const page = fakePage([pw]);
  page.run(scripts.secrets("mark")); // e.g. an earlier snapshot
  pw.type = "text"; // the show-password toggle
  assert.equal(page.run(scripts.secrets("scrub", "s3cret-value")), "[redacted]");
  // The snapshot's predicate is the same function: it is injected into every script as __isSecret.
  assert.equal(page.run(scripts.focusedIsPassword()), false); // nothing focused; the predicate is exercised through mask below
  page.run(scripts.secrets("mask"));
  assert.ok("data-pista-secret" in pw.attrs);
});

test("a script that reveals a password itself is still scrubbed", async () => {
  const pw = field("password", "s3cret-value");
  assert.equal(await evaluateScrubbed(driver(fakePage([pw]), () => ((pw.type = "text"), pw.value)), "reveal()"), '"[redacted]"');
});

test("when the secret check fails nothing is returned", async () => {
  // Calls: mark, the user's script, then the scrub.
  const fail = (last: () => unknown) => { let n = 0; return { evaluate: async () => (++n < 3 ? "hunter2-secret" : last()) } as unknown as BrowserDriver; };
  await assert.rejects(evaluateScrubbed(fail(() => { throw new Error("page gone"); }), "x"), /not returned/);
  await assert.rejects(evaluateScrubbed(fail(() => ({ not: "a string" })), "x"), /not returned/);
});

test("browser_eval returns the scrubbed text", async () => {
  const page = fakePage([field("password", "hunter2-secret")]);
  const tools = new Map<string, { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> }>();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver(page, () => "hunter2-secret"), { keepPageViews: 0 });
  const res = await tools.get("browser_eval")!.execute("t", { script: "x" });
  assert.equal(res.content[1]!.text, '"[redacted]"');
});

test("the screenshot mask style is added before capture and removed after, also when capture fails", async () => {
  const f = field("text", "visible-pw", { autocomplete: "current-password" });
  const page = fakePage([f]);
  let during: { styles: number; marked: boolean } | undefined;
  const d = driver(page, undefined, async () => ((during = { styles: page.styles.length, marked: "data-pista-secret" in f.attrs }), { data: "jpg", mimeType: "image/jpeg" }));
  assert.equal((await screenshotMasked(d)).data, "jpg");
  assert.deepEqual(during, { styles: 1, marked: true });
  assert.equal(page.styles.length, 0);
  assert.ok(!("data-pista-secret" in f.attrs));
  await assert.rejects(screenshotMasked(driver(page, undefined, async () => { throw new Error("boom"); })), /boom/);
  assert.equal(page.styles.length, 0);
});

test("no screenshot is taken when the mask cannot be applied", async () => {
  let shot = false;
  const d = { evaluate: async () => { throw new Error("no page"); }, screenshot: async () => ((shot = true), { data: "", mimeType: "" }) } as unknown as BrowserDriver;
  await assert.rejects(screenshotMasked(d), /could not be hidden/);
  assert.equal(shot, false);
});
