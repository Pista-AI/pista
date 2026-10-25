import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { scripts } from "../src/page-scripts.ts";
import { consequentialClick, consequentialPress, normalizeKey, passwordNote, RISKY, stopNote } from "../src/safety.ts";
import { registerBrowserTools } from "../src/tools.ts";

type Tool = { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[]; details: Record<string, unknown> }> };

test("RISKY matches purchase-class names and leaves ordinary ones alone", () => {
  for (const name of ["Place order", "Buy now", "Pay $5", "Delete account", "Send", "Sign in", "Log out", "Accept all", "Post", "Post comment", "Confirm", "Confirm order"]) assert.ok(RISKY.test(name), name);
  for (const name of ["Search", "Next", "Posts", "Add to cart", "Filters", "Post office", "Confirmation details", "Spend less"]) assert.ok(!RISKY.test(name), name);
  // Swedish, German, French, Spanish; whole words only, also around å, ä, ö.
  for (const name of ["Köp nu", "Betala", "Beställ", "Skicka", "Radera", "Ta bort", "Logga in", "Logga ut", "Bekräfta köp", "Jetzt kaufen", "Bezahlen", "Bestellen", "Senden", "Löschen", "Acheter", "Supprimer", "Comprar", "Enviar"]) assert.ok(RISKY.test(name), name);
  for (const name of ["Köpenhamn", "Betalning visas här", "Sändare"]) assert.ok(!RISKY.test(name), name);
});

test("consequentialClick names the target; only for acting elements", () => {
  assert.equal(consequentialClick("button", "Place order"), 'clicking button "Place order"');
  assert.match(stopNote(consequentialClick("button", "Place order")!, "Nothing was clicked."), /^Stopped: clicking button "Place order" looks like a consequential action .* needs the user's approval/);
  assert.equal(consequentialClick("button", "Search"), undefined);
  assert.equal(consequentialClick("checkbox", "Send me updates"), undefined);
  assert.equal(consequentialClick(undefined, undefined), undefined);
});

test("a link stops on a multi-word risky phrase anywhere in a short name, or a risky first word, in any supported language", () => {
  for (const name of [
    "Pay now", "Pay", "Buy", "Buy now", "Place order", "Betala", "Betala nu", "Köp", "Köp nu", "Sign in", "Log out", "Delete account", "Post", "Accept all", "Reserve a table", "Kaufen", "Comprar", "Sign in with Google",
    "Checkout", "Kassa", "Boka", "Boka bord", "Proceed to payment", "Proceed to checkout", "Go to checkout", "Complete purchase", "Complete your order", "Continue to payment", "Submit order", "Confirm booking",
    "Slutför köp", "Slutför beställningen", "Gå till kassan", "Zur Kasse", "Jetzt kaufen", "Menu / Pay now", "Cart: proceed to payment",
  ]) {
    assert.ok(consequentialClick("link", name), `link "${name}" should stop`);
  }
  // A single risky word that is not the first word is a noun in a title, and sentence-long names are not commands.
  for (const name of [
    "Maternity pay and leave", "Terms of purchase", "Fakturor och betala senare", "Your cart: pay", "Payment options", "Order history", "Pay and leave policy for staff", "How to send us a parcel",
    "Post office", "Betalning och leverans", "Kassaskåp", "Read our checkout policy for businesses", "Please read all about how to proceed to payment",
  ]) {
    assert.equal(consequentialClick("link", name), undefined, `link "${name}" should pass`);
  }
  // Buttons and role-less clickables are judged by any risky word, at any length.
  for (const kind of ["button", "div", "menuitem"]) assert.ok(consequentialClick(kind, "Maternity pay and leave policy for all staff"), kind);
});

test("a page-supplied role cannot hide what the tag is, and a long label cannot hide a risky word", () => {
  assert.ok(consequentialClick("textbox", "Delete account", "button"));
  assert.ok(consequentialClick("checkbox", "Pay now", "link"));
  assert.ok(consequentialClick("combobox", "Place order", "button"));
  // Without a tag-derived kind (a div that claims to be a textbox), a field role still means a field.
  assert.equal(consequentialClick("textbox", "Place order"), undefined);
  assert.ok(consequentialClick("button", `${"Continue ".repeat(40)}and pay`), "the risky word is past the 80th character");
  assert.equal(consequentialClick("link", "Please read all about how to pay"), undefined, "a link that long is a sentence");
});

test("page-supplied names are sanitized in the action text", () => {
  const action = consequentialClick("button", "Pay\u202E now\u0000\n\"q\"")!;
  assert.equal(action, 'clicking button "Pay now \\"q\\""');
  assert.ok(consequentialClick("a".repeat(50), "Pay now")!.startsWith(`clicking ${"a".repeat(19)}… "`));
  assert.ok(consequentialClick("button", "Pay " + "y".repeat(1000))!.length <= 160);
});

test("passwordNote never carries a value", () => {
  assert.match(passwordNote('input "Password"'), /secret field.*Nothing was entered.*type it themselves in the browser pane/);
});

// The rest needs real layout, so it drives a headless Chromium over CDP (PISTA_CHROME to point at one) and skips without it.
const CHROME = [
  process.env.PISTA_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && existsSync(p));
const skip = CHROME ? false : "no Chromium found (set PISTA_CHROME)";

let chrome: ChildProcess | undefined;
let dir = "";
let driver: CdpDriver;
const tools = new Map<string, Tool>();
/** What the test user answers when asked about a consequential action. */
let approver: (() => boolean) | undefined;
const fixture = (name: string) => pathToFileURL(resolve(import.meta.dirname, "fixture", name)).href;
const call = async (name: string, params: Record<string, unknown> = {}, id = "t") => {
  const res = await tools.get(name)!.execute(id, params);
  const meta = JSON.parse(res.content[0]!.text!) as { url: string; title: string; result?: string; note?: string };
  return { meta, body: res.content[1]?.text ?? "" };
};
const refOf = (snapshot: string, pattern: RegExp) => snapshot.match(pattern)?.[1] ?? assert.fail(`no ${pattern} in snapshot:\n${snapshot}`);

before(async () => {
  if (!CHROME) return;
  dir = mkdtempSync(join(tmpdir(), "pista-safety-"));
  const ci = process.env.CI ? ["--no-sandbox", "--disable-gpu"] : ["--disable-gpu"];
  chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", ...ci, "about:blank"], { stdio: "ignore" });
  let port = "";
  // Wait up to 30 s: parallel test files start several Chromes at once and a loaded CI runner needs more than 10 s.
  for (let i = 0; i < 300 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      port = readFileSync(join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]!;
    } catch {
      /* not started yet */
    }
  }
  if (!port) throw new Error(`Chrome at ${CHROME} did not open a DevTools port (no DevToolsActivePort in ${dir} after 30 s; exit code ${chrome.exitCode})`);
  driver = new CdpDriver(`http://127.0.0.1:${port}`);
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver, { keepPageViews: 0, askApproval: async () => approver?.() ?? false });
});

after(async () => {
  if (chrome && chrome.exitCode === null) {
    const closed = new Promise((r) => chrome!.once("close", r));
    chrome.kill();
    await closed;
  }
  // Best effort: Chrome helper processes can still write to the profile after the main
  // process exits (seen on CI as ENOTEMPTY); a leftover temp dir must not fail the run.
  try {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
});

test("browser_navigate declines a cookie banner (reject, never accept) and says so", { skip }, async () => {
  const { meta } = await call("browser_navigate", { url: fixture("banner.html") });
  assert.equal(meta.title, "declined");
  assert.match(meta.note ?? "", /Declined the cookie banner \(clicked "Reject all"\)/);
  assert.equal(await driver.evaluate("document.getElementById('cookies') === null"), true);
});

test("browser_navigate to a page without a banner has no cookie note", { skip }, async () => {
  const { meta } = await call("browser_navigate", { url: fixture("risky.html") });
  assert.equal(meta.title, "Shop");
  assert.equal(meta.note, undefined);
});

test("browser_click stops a consequential click, names it, and clicks only when the user approves it through the host", { skip }, async () => {
  await call("browser_navigate", { url: fixture("risky.html") });
  const { body } = await call("browser_snapshot");
  const order = refOf(body, /\[(e\d+)\] button "Place order"/);

  const refused = await call("browser_click", { ref: order, confirm: true });
  assert.match(refused.meta.note ?? "", /Stopped: clicking button "Place order" looks like a consequential action/);
  assert.match(refused.meta.note ?? "", /needs the user's approval/);
  assert.equal(refused.meta.title, "Shop", "the page must be untouched, whatever the model passes");

  approver = () => true;
  const done = await call("browser_click", { ref: order });
  approver = undefined;
  assert.equal(done.meta.title, "ordered");
});

test("browser_click also stops on a submit input and a link, but not on an ordinary button", { skip }, async () => {
  await call("browser_navigate", { url: fixture("risky.html") });
  const { body } = await call("browser_snapshot");
  const del = await call("browser_click", { ref: refOf(body, /\[(e\d+)\] button "Delete account"/) });
  assert.match(del.meta.note ?? "", /Stopped: clicking button "Delete account"/);
  const signIn = await call("browser_click", { ref: refOf(body, /\[(e\d+)\] link "Sign in"/) });
  assert.match(signIn.meta.note ?? "", /Stopped: clicking link "Sign in"/);
  const search = await call("browser_click", { ref: refOf(body, /\[(e\d+)\] button "Search"/) });
  assert.equal(search.meta.note, undefined);
  assert.equal(search.meta.title, "searched");
});

test("browser_type refuses password fields without typing or echoing the value, and types into ordinary fields", { skip }, async () => {
  await call("browser_navigate", { url: fixture("risky.html") });
  const { body } = await call("browser_snapshot");
  const secret = "hunter2-secret";
  for (const pattern of [/\[(e\d+)\] textbox:password "Password"/, /\[(e\d+)\] textbox "New"/]) {
    const refused = await call("browser_type", { ref: refOf(body, pattern), text: secret });
    assert.match(refused.meta.note ?? "", /secret field.*Nothing was entered\. Ask the user to type it themselves in the browser pane/);
    assert.ok(!JSON.stringify(refused).includes(secret), "the value must never be echoed");
  }
  assert.equal(await driver.evaluate("[...document.querySelectorAll('input:not([type=submit])')].map((i) => i.value).join('')"), "");

  const ok = await call("browser_type", { ref: refOf(body, /\[(e\d+)\] textbox "Name"/), text: "Ada" });
  assert.equal(ok.meta.note, undefined);
  assert.equal(await driver.evaluate("document.querySelector('input[type=text]').value"), "Ada");
});

test("derived names, role-less clickables and other languages are stopped; look-alike words are not", { skip }, async () => {
  await call("browser_navigate", { url: fixture("risky2.html") });
  const { body } = await call("browser_snapshot");
  const click = (pattern: RegExp) => call("browser_click", { ref: refOf(body, pattern) });
  const note = async (pattern: RegExp) => (await click(pattern)).meta;
  const icon = await note(/\[(e\d+)\] button ~"Delete"/);
  assert.match(icon.note ?? "", /Stopped: clicking button "[^"]*Delete/);
  assert.equal(icon.title, "Shop 2");
  assert.match((await note(/\[(e\d+)\] button ~"Remove account"/)).note ?? "", /Stopped: clicking/);
  assert.equal(await driver.evaluate("document.title"), "Shop 2");
  // Role-less div / role=presentation: found by selector, since they are not in the snapshot.
  for (const [selector, text] of [["#kop", "Köp nu"], ["#pay", "Betala"]] as const) {
    const refused = await call("browser_click", { ref: selector });
    assert.match(refused.meta.note ?? "", new RegExp(`Stopped: clicking (div|presentation) "${text}"`));
  }
  assert.equal(await driver.evaluate("document.title"), "Shop 2");
  assert.equal((await note(/\[(e\d+)\] link "Post office"/)).title, "po");
  assert.equal((await note(/\[(e\d+)\] link "Confirmation details"/)).title, "conf");
  assert.match((await note(/\[(e\d+)\] link "Post"/)).note ?? "", /Stopped: clicking/);
});

test("browser_type with submit holds back Enter on a consequential submit button, types anyway, and submits once the user approves it", { skip }, async () => {
  await call("browser_navigate", { url: fixture("risky2.html") });
  const { body } = await call("browser_snapshot");
  const field = refOf(body, /\[(e\d+)\] textbox "Query"/);
  const held = await call("browser_type", { ref: field, text: "abc", submit: true });
  assert.match(held.meta.note ?? "", /Stopped: pressing Enter, which would press button "Place order" looks like a consequential action/);
  assert.equal(await driver.evaluate("document.title"), "Shop 2");
  assert.equal(await driver.evaluate("document.querySelectorAll('input[type=text]')[0].value"), "abc");
  approver = () => true;
  await call("browser_type", { ref: field, text: "abc", submit: true });
  approver = undefined;
  assert.equal(await driver.evaluate("document.title"), "submitted");

  await call("browser_navigate", { url: fixture("risky2.html") });
  const snap = (await call("browser_snapshot")).body;
  const ok = await call("browser_type", { ref: refOf(snap, /\[(e\d+)\] textbox "Find"/), text: "x", submit: true });
  assert.equal(ok.meta.note, undefined);
  assert.equal(await driver.evaluate("document.title"), "searched");
});

test("browser_press refuses while a password field has focus, and presses otherwise", { skip }, async () => {
  await call("browser_navigate", { url: fixture("risky2.html") });
  await driver.evaluate("document.querySelector('input[type=password]').focus()");
  const refused = await call("browser_press", { key: "Enter" });
  assert.match(refused.meta.note ?? "", /secret field.*Nothing was entered/);
  await driver.evaluate("document.querySelector('input[type=text]').focus()");
  const ok = await call("browser_press", { key: "Escape" });
  assert.equal(ok.meta.note, undefined);
  assert.match(ok.meta.result ?? "", /Pressed Escape/);
});

test("normalizeKey: aliases collapse to one spelling, case-insensitively, by the last part of a chord", () => {
  for (const [from, to] of [["Return", "Enter"], ["return", "Enter"], ["enter", "Enter"], ["Control+Return", "Control+Enter"], ["Shift+return", "Shift+Enter"], ["Spacebar", "Space"], ["spacebar", "Space"], ["space", "Space"], ["Control+Spacebar", "Control+Space"], ["numpadenter", "NumpadEnter"], ["Escape", "Escape"], ["Control+A", "Control+A"], ["Control++", "Control++"], ["a", "a"], [" ", " "]]) assert.equal(normalizeKey(from), to, from);
  const field = { kind: "input", name: "Card", submitName: "Pay now" };
  for (const key of ["Return", "return", "Control+Return", "Meta+return"]) assert.match(consequentialPress(key, field) ?? "", /^pressing Enter, which would press button "Pay now"/, key);
  assert.match(consequentialPress("Spacebar", { kind: "button", name: "Pay now" }) ?? "", /^pressing Space on button "Pay now"/);
  assert.equal(consequentialPress("Control+Return", { kind: "textarea", name: "Message" }), undefined);
});

test("consequentialPress: chords count by their last part, textareas and form-less inputs do not stop, unreadable focus fails closed", () => {
  const field = { kind: "input", name: "Card", submitName: "Pay now" };
  for (const key of ["Enter", "NumpadEnter", "Control+Enter", "Meta+Enter", "Shift+Enter", "Control+Shift+Enter", "Space", " ", "Shift+Space"]) assert.ok(consequentialPress(key, key.endsWith("pace") || key === " " ? { kind: "button", name: "Pay now" } : field), key);
  for (const key of ["Escape", "Tab", "ArrowDown", "Control+A", "Shift+Tab"]) assert.equal(consequentialPress(key, field), undefined, key);
  assert.equal(consequentialPress("Enter", { kind: "textarea", name: "Message" }), undefined);
  assert.equal(consequentialPress("Control+Enter", { kind: "textarea", name: "Message" }), undefined);
  assert.equal(consequentialPress("Enter", { kind: "input", name: "Search" }), undefined, "an input outside a form");
  assert.equal(consequentialPress("Enter", { error: "Nothing has focus." }), undefined);
  assert.equal(consequentialPress("Enter", { kind: "button", name: "Search" }), undefined);
  for (const key of ["Enter", "Control+Enter", "Space"]) {
    assert.match(consequentialPress(key, undefined) ?? "", /could not be inspected/);
    assert.match(consequentialPress(key, { unreadable: true }) ?? "", /could not be inspected/);
  }
  assert.equal(consequentialPress("Escape", undefined), undefined);
  // A role that hides a real button on the focused element does not help.
  assert.ok(consequentialPress("Enter", { kind: "textbox", name: "Delete account", tagKind: "button" }));
});

test("a page role cannot hide a real button, and a long label cannot hide its risky word (real page)", { skip }, async () => {
  await call("browser_navigate", { url: fixture("risky3.html") });
  assert.match((await call("browser_click", { ref: "#role" })).meta.note ?? "", /Stopped: clicking textbox "Delete account"|Stopped: clicking button "Delete account"/);
  assert.match((await call("browser_click", { ref: "#long" })).meta.note ?? "", /Stopped: clicking button "/);
  assert.equal(await driver.evaluate("document.title"), "Shop 3");
});

test("browser_press stops Enter in a payment form, also as a chord, but not in a textarea or a form-less input (real page)", { skip }, async () => {
  await call("browser_navigate", { url: fixture("risky3.html") });
  for (const [selector, key, stops] of [
    ["input[type=text]", "Enter", true],
    ["input[type=text]", "Control+Enter", true],
    ["textarea", "Enter", false],
    ["#loose", "Enter", false],
  ] as const) {
    await driver.evaluate(selector === "input[type=text]" ? "document.querySelectorAll('input[type=text]')[0].focus()" : `document.querySelector('${selector}').focus()`);
    const meta = (await call("browser_press", { key })).meta;
    if (stops) assert.match(meta.note ?? "", /Stopped: pressing Enter, which would press button "Pay now"/, `${selector} ${key}`);
    else assert.equal(meta.note, undefined, `${selector} ${key}`);
  }
  assert.equal(await driver.evaluate("document.title"), "Shop 3");
});

test("a field known only by its label is masked in the snapshot and refused by browser_type; an ordinary field is neither", { skip }, async () => {
  await call("browser_navigate", { url: fixture("secrets.html") });
  const { body } = await call("browser_snapshot");
  for (const value of ["4111111111111111", "123456", "19900101-1234"]) assert.ok(!body.includes(value), `${value} must not appear in the snapshot`);
  assert.match(body, /\[e\d+\] textbox "Card number".*value="•••"/);
  assert.match(body, /\[e\d+\] textbox "Shipping address".*value="Main Street 1"/);
  const typed = "9999888877776666";
  for (const pattern of [/\[(e\d+)\] textbox "Card number"/, /\[(e\d+)\] textbox "One-time code"/, /\[(e\d+)\] textbox "SSN"/]) {
    const refused = await call("browser_type", { ref: refOf(body, pattern), text: typed });
    assert.match(refused.meta.note ?? "", /secret field.*Nothing was entered\. Ask the user to type it themselves in the browser pane/);
    assert.ok(!JSON.stringify(refused).includes(typed));
  }
  assert.equal(await driver.evaluate("document.getElementById('f1').value"), "4111111111111111");
  const ok = await call("browser_type", { ref: refOf(body, /\[(e\d+)\] textbox "Shipping address"/), text: "Elm Road 2" });
  assert.equal(ok.meta.note, undefined);
  assert.equal(await driver.evaluate("document.getElementById('f2').value"), "Elm Road 2");
  // browser_press applies the same check to the focused field.
  await driver.evaluate("document.getElementById('f1').focus()");
  assert.match((await call("browser_press", { key: "Escape" })).meta.note ?? "", /secret field.*Nothing was entered/);
  await driver.evaluate("document.getElementById('f2').focus()");
  assert.equal((await call("browser_press", { key: "Escape" })).meta.note, undefined);
});

test("the control name used by the stops holds a field's value only for button-like inputs", { skip }, async () => {
  await call("browser_navigate", { url: fixture("secrets.html") });
  await call("browser_snapshot");
  const peek = async (selector: string) => (await driver.evaluate(scripts.prepare(selector, "peek"))) as { name: string; submitName?: string };
  const note = await peek("#note");
  assert.ok(!/Place order/.test(note.name), `a text field's value is not its name: ${note.name}`);
  assert.equal(note.submitName, "Save draft", "a submit input is still named by its value");
  assert.ok(!/Delete account/.test((await peek("input[aria-label=Notes]")).name));
});
