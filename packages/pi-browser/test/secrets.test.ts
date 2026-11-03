import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { test } from "node:test";
import type { BrowserDriver } from "../src/driver.ts";
import { evaluateScrubbed, screenshotMasked } from "../src/secrets.ts";
import { registerBrowserTools } from "../src/tools.ts";

/** A just-enough DOM: a flat list of inputs, no layout. The real injected page scripts run against it. */
class FakeNodeList { [i: number]: unknown; constructor(private items: unknown[]) { items.forEach((x, i) => (this[i] = x)); } get length() { return this.items.length; } item(i: number) { return this.items[i]; } }
class FakeInput {
  tagName = "INPUT"; id = ""; type: string; _v: string; attrs: Record<string, string>;
  constructor(type: string, value: string, attrs: Record<string, string> = {}) { this.type = type; this._v = value; this.attrs = { ...attrs }; }
  get value() { return this._v; }
  set value(v: string) { this._v = v; }
  get shadowRoot() { return null; }
  getAttribute(n: string) { return this.attrs[n] ?? null; }
  setAttribute(n: string, v: string) { this.attrs[n] = v; }
  removeAttribute(n: string) { delete this.attrs[n]; }
}
const input = (type: string, value: string, attrs?: Record<string, string>) => new FakeInput(type, value, attrs);

function fakePage(fields: FakeInput[]) {
  const styles: { remove(): void }[] = [];
  const list = (items: unknown[]) => new FakeNodeList(items);
  class Doc {
    nodeType = 9; head = { appendChild: (s: { remove(): void }) => void styles.push(s) }; documentElement = {};
    createElement() { const style = { setAttribute() {}, textContent: "", remove: () => void styles.splice(styles.indexOf(style), 1) }; return style; }
    querySelectorAll(sel: string) { return list(sel === "input" || sel === "*" ? fields : sel.startsWith("style") ? [...styles] : []); }
    getElementById() { return null; }
  }
  // The page's own realm: builtins are the context's, so a script that patches them cannot touch this test process.
  const ctx = createContext({
    document: new Doc(), Document: Doc, DocumentFragment: class { querySelectorAll() { return list([]); } }, NodeList: FakeNodeList,
    Element: FakeInput, HTMLInputElement: FakeInput, HTMLTextAreaElement: class { get value() { return ""; } }, HTMLIFrameElement: class { get contentDocument() { return null; } },
  });
  runInContext("var window = globalThis", ctx);
  return { styles, run: (script: string) => runInContext(script, ctx) };
}

/** A driver over the fake page: page scripts run for real. */
function driver(page: ReturnType<typeof fakePage>, shot: () => Promise<{ data: string; mimeType: string }> = async () => ({ data: "jpg", mimeType: "image/jpeg" })) {
  return {
    state: async () => ({ url: "http://x/", title: "t", loading: false }),
    evaluate: async (script: string) => page.run(script),
    screenshot: shot,
  } as unknown as BrowserDriver;
}
/** The script as the model would write it: it sees the page's own `window`/`document` via the fake's globals. */
const withPw = (value = "hunter2-secret", type = "password") => { const pw = input(type, value); return { pw, page: fakePage([pw]) }; };

test("an autofilled password in an eval result comes back as [redacted]", async () => {
  const page = fakePage([input("password", "hunter2-secret"), input("text", "alice", { name: "user" })]);
  const text = await evaluateScrubbed(driver(page), `({ pw: "hunter2-secret", who: "alice", list: ["x hunter2-secret y"], esc: 'a"b' })`);
  assert.ok(!text.includes("hunter2-secret"));
  assert.match(text, /"pw": "\[redacted\]"/);
  assert.match(text, /alice/); // an ordinary field is untouched
});

test("a value under 6 characters is left alone, a JSON-escaped secret is scrubbed", async () => {
  assert.match(await evaluateScrubbed(driver(fakePage([input("password", "abcde")])), `"abcde"`), /"abcde"/);
  assert.equal(await evaluateScrubbed(driver(fakePage([input("password", 'pa"ss"word')])), `'pa"ss"word'`), '"[redacted]"');
});

test("a password field toggled to type=text stays secret", async () => {
  const { pw, page } = withPw("s3cret-value");
  page.run("window"); // any page script has not run yet; the eval itself classifies the field first
  assert.equal(await evaluateScrubbed(driver(page), `"s3cret-value"`), '"[redacted]"');
  pw.type = "text"; // the show-password toggle, after the field was seen as a password
  assert.equal(await evaluateScrubbed(driver(page), `"s3cret-value"`), '"[redacted]"');
});

test("a script that reveals or changes the field itself is still scrubbed", async () => {
  const a = withPw("s3cret-value");
  assert.equal(await evaluateScrubbed(driver(a.page), `(document.querySelectorAll("input")[0].type = "text", "s3cret-value")`), '"[redacted]"');
  const b = withPw("s3cret-value");
  assert.equal(await evaluateScrubbed(driver(b.page), `(document.querySelectorAll("input")[0].value = "", "s3cret-value")`), '"[redacted]"'); // cleared: collected up front
  const c = withPw("s3cret-value");
  assert.equal(await evaluateScrubbed(driver(c.page), `(document.querySelectorAll("input")[0].value = "brand-new-secret", "brand-new-secret")`), '"[redacted]"'); // set: collected at the end
});

test("a script that throws the secret gives a scrubbed error", async () => {
  const { page } = withPw("s3cret-value");
  await assert.rejects(evaluateScrubbed(driver(page), `throw new Error(document.querySelectorAll("input")[0].value)`), (e: Error) => e.message.includes("[redacted]") && !e.message.includes("s3cret-value"));
});

test("a script that patches String, JSON and the marker before returning the secret is still redacted", async () => {
  const { pw, page } = withPw("s3cret-value");
  const attack = `(() => {
    String.prototype.split = () => []; String.prototype.replaceAll = (a, b) => b; String.prototype.indexOf = () => -1; String.prototype.slice = () => "";
    String.prototype[Symbol.split] = () => []; JSON.stringify = () => "leak";
    Array.prototype.push = () => 0; WeakSet.prototype.has = () => false;
    try { window.__pistaSecretMarks = { add() {}, has: () => false }; } catch {}
    try { Object.defineProperty(window, "__pistaSecretMarks", { value: {} }); } catch {}
    const f = document.querySelectorAll("input")[0]; f.type = "text";
    return ["s3cret-value"];
  })()`;
  const text = await evaluateScrubbed(driver(page), attack);
  assert.ok(!text.includes("s3cret-value"), text);
  assert.ok(pw.value === "s3cret-value");
});

test("when the checking evaluation fails or reports nothing usable, nothing is returned", async () => {
  for (const odd of [undefined, "raw", { ok: true }, { ok: true, text: 5 }]) await assert.rejects(evaluateScrubbed({ evaluate: async () => odd } as unknown as BrowserDriver, "x"), /not returned/);
});

test("statement-form scripts still run, and a compile error in both forms is reported", async () => {
  const { page } = withPw("s3cret-value");
  assert.equal(await evaluateScrubbed(driver(page), `const a = 20; return a + 1`), "21");
  assert.equal(await evaluateScrubbed(driver(page), `await Promise.resolve(2)`), "2");
  await assert.rejects(evaluateScrubbed(driver(page), `if (`), /Unexpected|SyntaxError/);
});

test("source that tries to break out of the wrapper is rejected on the host or stays inside the scrub", async () => {
  const attempts = [
    `1)}); leak(); (()=>{(`,
    `1)}); (document.querySelectorAll("input")[0].value); (()=>{ return (0`,
    `0)}); ({ok:true,text:document.querySelectorAll("input")[0].value}); (()=>{ return (0`,
    `0)}, "n"); })(); ({ok:true,text:document.querySelectorAll("input")[0].value}); (() => { (async () => { return (0`,
    `0); }); throw 1; /*`,
    `function f() { return document.querySelectorAll("input")[0].value } return f() // trailing comment`,
  ];
  for (const attempt of attempts) {
    const { page } = withPw("s3cret-value");
    let sent = 0;
    const d = { ...driver(page), evaluate: async (script: string) => (sent++, page.run(script)) } as BrowserDriver;
    let out: string;
    try { out = await evaluateScrubbed(d, attempt); } catch (e) { out = (e as Error).message; }
    assert.ok(!out.includes("s3cret-value"), attempt);
    if (sent === 0) assert.match(out, /was not run/, attempt); // rejected before anything was sent
  }
  // The first five do not compile on their own: nothing is sent for them.
  for (const attempt of attempts.slice(0, 5)) {
    let sent = 0;
    await assert.rejects(evaluateScrubbed({ evaluate: async () => (sent++, { ok: true, text: "x" }) } as unknown as BrowserDriver, attempt), /was not run/);
    assert.equal(sent, 0, attempt);
  }
});

test("a long result is cut", async () => {
  const text = await evaluateScrubbed({ evaluate: async () => ({ ok: true, text: "a".repeat(150_000) }) } as unknown as BrowserDriver, "x");
  assert.ok(text.length < 100_300 && text.includes("cut"));
});

test("browser_eval returns the scrubbed text", async () => {
  const { page } = withPw("hunter2-secret");
  const tools = new Map<string, { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> }>();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver(page), { keepPageViews: 0 });
  const res = await tools.get("browser_eval")!.execute("t", { script: `"hunter2-secret"` });
  assert.equal(res.content[1]!.text, '"[redacted]"');
});

test("the screenshot mask style is added before capture and removed after, also when capture fails", async () => {
  const f = input("text", "visible-pw", { autocomplete: "current-password" });
  const page = fakePage([f]);
  let during: { styles: number; marked: boolean } | undefined;
  const d = driver(page, async () => ((during = { styles: page.styles.length, marked: "data-pista-secret" in f.attrs }), { data: "jpg", mimeType: "image/jpeg" }));
  assert.equal((await screenshotMasked(d)).data, "jpg");
  assert.deepEqual(during, { styles: 1, marked: true });
  assert.equal(page.styles.length, 0);
  assert.ok(!("data-pista-secret" in f.attrs));
  await assert.rejects(screenshotMasked(driver(page, async () => { throw new Error("boom"); })), /boom/);
  assert.equal(page.styles.length, 0);
});

test("a failing unmask warns without values and still returns the screenshot", async () => {
  let n = 0;
  const d = { evaluate: async () => { if (++n > 1) throw new Error("gone s3cret-value"); return ""; }, screenshot: async () => ({ data: "jpg", mimeType: "image/jpeg" }) } as unknown as BrowserDriver;
  const warns: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(a.join(" "));
  try {
    assert.equal((await screenshotMasked(d)).data, "jpg");
  } finally {
    console.warn = original;
  }
  assert.equal(warns.length, 1);
  assert.ok(!warns[0]!.includes("s3cret-value"));
});

test("no screenshot is taken when the mask cannot be applied", async () => {
  let shot = false;
  const d = { evaluate: async () => { throw new Error("no page"); }, screenshot: async () => ((shot = true), { data: "", mimeType: "" }) } as unknown as BrowserDriver;
  await assert.rejects(screenshotMasked(d), /could not be hidden/);
  assert.equal(shot, false);
});
