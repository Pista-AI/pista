import assert from "node:assert/strict";
import { test } from "node:test";
import { runPageAction } from "../src/actions.ts";
import { describeEffect, NO_VISIBLE_CHANGE } from "../src/effect.ts";
import type { BrowserDriver } from "../src/driver.ts";
import { cutInline, cutMarker, formatSnapshot, scripts, SECRET_FIELD, type ControlReading, type PageObservation } from "../src/page-scripts.ts";

const reading = (over: Partial<ControlReading> = {}): ControlReading => ({ role: "combobox", name: "Where to?", control: true, editable: true, native: true, popup: true, ...over });
const obs = (over: Partial<PageObservation> = {}): PageObservation => ({ href: "http://x/a", title: "T", fp: "1", options: 0, target: reading({ value: "" }), ...over });

test("typing into a combobox whose suggestion list opened says the value is not committed", () => {
  const before = obs();
  const after = obs({ fp: "2", options: 5, target: reading({ value: "Bar", expanded: true }), focus: { ...reading({ value: "Bar", expanded: true }), onTarget: true } });
  const text = describeEffect("type", before, after, "Bar");
  assert.match(text, /^URL unchanged\. The field shows "Bar" \(was empty\)\./);
  assert.match(text, /suggestion list is open with 5 options; the value is not committed yet; if this field needs a listed value, choose one\./);
});

test("a field that stayed empty is called out, and so is a value the page replaced", () => {
  assert.match(describeEffect("type", obs(), obs({ fp: "2", target: reading({ value: "" }) }), "Barcelona"), /The field is empty \(unchanged\)\. The text did not stick\./);
  assert.match(describeEffect("type", obs(), obs({ fp: "2", target: reading({ value: "Paris" }) }), "Barcelona"), /The field shows "Paris", which differs from the text sent \(it may be formatted\)\./);
  assert.doesNotMatch(describeEffect("type", obs(), obs({ fp: "2", target: reading({ value: "" }) }), "hello", true), /did not stick/);
  assert.match(describeEffect("type", obs({ target: reading({ value: "x" }) }), obs({ fp: "2", target: reading({ value: "" }) }), "hello", true), /The field is empty now \(it may have been submitted\)\./);
  assert.match(describeEffect("type", obs(), obs({ fp: "2", target: reading({ value: "Barcelona (BCN)" }) }), "Barcelona"), /^((?!not what you typed).)*$/);
});

test("a click that changes nothing says so, and moving focus alone is not an effect of a click on a button", () => {
  const button = reading({ role: "button", name: "Go", control: false, editable: false, native: false, popup: false });
  const before = obs({ target: button });
  const after = obs({ target: button, focus: { ...button, onTarget: true } });
  assert.equal(describeEffect("click", before, after), NO_VISIBLE_CHANGE);
});

test("a click that navigates reports the URL change, with the title", () => {
  const text = describeEffect("click", obs(), obs({ href: "http://x/b", title: "B", fp: "9", target: null }));
  assert.equal(text, 'URL changed (was /a). Title is now "B".');
});

test("toggles, opened lists and focus moves are reported", () => {
  const box = reading({ role: "checkbox", name: "Flex", value: "unchecked", editable: false, popup: false });
  assert.match(describeEffect("click", obs({ target: box }), obs({ fp: "2", target: { ...box, value: "checked" } })), /Now checked \(was unchecked\)\./);
  const menu = reading({ role: "button", name: "Menu", control: false, editable: false, native: false, popup: false });
  assert.match(describeEffect("click", obs({ target: menu }), obs({ fp: "2", target: { ...menu, expanded: true } })), /A list is open\./);
  const next = reading({ role: "textbox", name: "To", value: "Lisbon", onTarget: false });
  assert.match(describeEffect("press", obs({ target: undefined }), obs({ fp: "1", target: undefined, focus: next })), /Focus is now on textbox "To" \(shows "Lisbon"\)\./);
});

test("passwords, card numbers and one-time codes never echo the value", () => {
  const secret = (value: string) => reading({ role: "textbox", name: "Card", value, sensitive: true, popup: false });
  const text = describeEffect("type", obs({ target: secret("") }), obs({ fp: "2", target: secret("h4sh"), focus: { ...secret("h4sh"), onTarget: false } }), "4111111111111111");
  assert.match(text, /The field value changed\./);
  assert.doesNotMatch(text, /4111|h4sh/);
  assert.doesNotMatch(text, /differs from|did not stick/);
});

test("nothing is said when the page could not be observed", () => {
  assert.equal(describeEffect("click", undefined, obs()), "");
  assert.equal(describeEffect("click", obs(), undefined), "");
});

test("the no-change line promises nothing about timing", () => {
  assert.equal(NO_VISIBLE_CHANGE, "No visible change yet.");
});

test("the cut marker says how much was cut and how to get it", () => {
  assert.equal(cutMarker(1240), "…[cut: 1,240 more chars — use browser_read]");
  assert.equal(cutMarker(12, "elements", "scroll or raise maxElements"), "…[cut: 12 more elements — scroll or raise maxElements]");
  const snap = (lines: string[]) => formatSnapshot({ lines, count: 3, omitted: 7, scroll: { y: 0, height: 10, viewport: 10 }, elements: [] });
  assert.match(snap([]), /3 interactive elements …\[cut: 7 more elements — scroll or raise maxElements\]\./);
  assert.doesNotMatch(snap([]), /= text was cut/);
  assert.match(snap(['[e1] link "abc…[+49 chars]"']), /…\[\+N chars\] = text was cut; browser_read gives the full text\./);
  assert.equal(cutInline(1240), "…[+1,240 chars]");
  assert.equal(cutInline(1), "…[+1 char]");
  assert.equal(cutMarker(1, "elements", "scroll"), "…[cut: 1 more element — scroll]");
});

test("browser_read marks text cut by maxChars, and leaves text that fits alone", async () => {
  const page = "x".repeat(1500);
  const driver = { setActivity: () => {}, evaluate: async () => page } as unknown as BrowserDriver;
  const cut = (await runPageAction(driver, { action: "read", maxChars: 1000 })).text!;
  assert.equal(cut, `${"x".repeat(1000)}\n…[cut: 500 more chars — call again with a larger maxChars]`);
  assert.equal((await runPageAction(driver, { action: "read" })).text, page);
});

test("secret-field matching is by whole token: \"PIN code\" is masked, \"shipping address\" is not", () => {
  const secret = new RegExp(SECRET_FIELD, "i");
  for (const masked of ["PIN code", "pin", "user_pin", "cc-number", "Enter OTP", "CVV", "ssn", "Card number", "Security code", "password"]) assert.ok(secret.test(masked), masked);
  for (const plain of ["shipping address", "shipping", "Shipping code", "spin code", "topping", "accounting", "Description", "cardigan"]) assert.ok(!secret.test(plain), plain);
});

test("effect feedback is off unless PI_BROWSER_EFFECT_FEEDBACK=1: no page reads around the action, the plain wording", async () => {
  const run = async () => {
    let observed = 0;
    let fp = 0;
    const driver = {
      setActivity: () => {},
      state: async () => ({ url: "http://x/a", title: "T", loading: false }),
      evaluate: async (script: string) => {
        if (script === scripts.prepare("e1", "select", "B")) return { label: 'combobox "X"', value: "B" };
        if (script === scripts.observe("e1")) return (observed++, { href: "http://x/a", title: "T", fp: String(fp++), options: 0, target: reading({ value: "B" }) });
        if (script === scripts.snapshot(150) || script === scripts.snapshot(150, false, true)) return { lines: [], count: 0, omitted: 0, scroll: { y: 0, height: 10, viewport: 10 }, elements: [] };
        return undefined;
      },
    } as unknown as BrowserDriver;
    const result = await runPageAction(driver, { action: "select", target: "e1", option: "B" });
    return { observed, outcome: result.outcome! };
  };
  const saved = process.env.PI_BROWSER_EFFECT_FEEDBACK;
  try {
    delete process.env.PI_BROWSER_EFFECT_FEEDBACK;
    assert.deepEqual(await run(), { observed: 0, outcome: 'Selected "B" in combobox "X".' });
    process.env.PI_BROWSER_EFFECT_FEEDBACK = "1";
    const on = await run();
    assert.equal(on.observed, 2);
    assert.ok(on.outcome.startsWith('Selected "B" in combobox "X".') && on.outcome.length > 'Selected "B" in combobox "X".'.length, on.outcome);
  } finally {
    if (saved === undefined) delete process.env.PI_BROWSER_EFFECT_FEEDBACK;
    else process.env.PI_BROWSER_EFFECT_FEEDBACK = saved;
  }
});
