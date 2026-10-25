import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserDriver } from "../src/driver.ts";
import type { PreparedTarget } from "../src/page-scripts.ts";
import { scripts } from "../src/page-scripts.ts";
import { registerBrowserTools, type BrowserToolOptions } from "../src/tools.ts";

type Tool = { parameters: { properties: Record<string, unknown> }; execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[] }> };

/** A page that has one element (e1) and a focused element, and records the input it was sent. */
function setup(target: PreparedTarget | (() => PreparedTarget), focused: PreparedTarget | (() => PreparedTarget) = { error: "none" }, options: BrowserToolOptions = {}) {
  const inputs: { type: string; key?: string; text?: string }[] = [];
  const driver = {
    state: async () => ({ url: "http://fixture/", title: "t", loading: false }),
    input: async (e: { type: string; key?: string; text?: string }) => (inputs.push(e), true),
    evaluate: async (script: string) => {
      if (script === scripts.frames()) return true;
      if (script === scripts.prepare("e1", "click") || script === scripts.prepare("e1", "type")) return { label: "x", x: 5, y: 5, ...(typeof target === "function" ? target() : target) };
      if (script === scripts.prepare(":focus", "peek")) return typeof focused === "function" ? focused() : focused;
      if (script === scripts.snapshot(150) || script === scripts.snapshot(150, false, true)) return { lines: [], count: 0, omitted: 0, scroll: { y: 0, height: 10, viewport: 10 }, elements: [] };
      if (script === scripts.selectActive()) return { editable: true, label: "q" };
      return undefined;
    },
  } as unknown as BrowserDriver;
  const tools = new Map<string, Tool>();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver, { keepPageViews: 0, ...options });
  const run = async (name: string, params: Record<string, unknown>, signal?: AbortSignal) => {
    const res = await (tools.get(name)!.execute as (id: string, params: Record<string, unknown>, signal?: AbortSignal) => ReturnType<Tool["execute"]>)("call-1", params, signal);
    return JSON.parse(res.content[0]!.text!) as { result?: string; note?: string };
  };
  return { inputs, tools, run };
}

const PAY = { kind: "button", name: "Place order" };
const ABORTED = /^Stopped: the run was stopped while the user was being asked about clicking button "Place order"\. Nothing was clicked\./;
const STOPPED = /^Stopped: clicking button "Place order" looks like a consequential action .* needs the user's approval, which was not given\. Nothing was clicked\. Tell the user what you were about to do/;

test("the model cannot lift a stop: no tool has a confirm argument, and one passed anyway is ignored", async () => {
  const s = setup(PAY);
  for (const name of ["browser_click", "browser_type", "browser_press"]) assert.ok(!("confirm" in s.tools.get(name)!.parameters.properties), `${name} still has confirm`);
  const meta = await s.run("browser_click", { ref: "e1", confirm: true });
  assert.match(meta.note ?? "", STOPPED);
  assert.deepEqual(s.inputs, [], "nothing may be clicked");
});

test("only the host's askApproval lifts a stop, once per action, and it is asked with the exact action", async () => {
  const asked: unknown[] = [];
  const s = setup(PAY, undefined, { askApproval: async (r) => (asked.push(r), true) });
  assert.equal((await s.run("browser_click", { ref: "e1" })).note, undefined);
  assert.equal(s.inputs.length, 1);
  assert.equal((await s.run("browser_click", { ref: "e1" })).note, undefined);
  assert.deepEqual(asked, [
    { toolName: "browser_click", action: 'clicking button "Place order"', signal: undefined },
    { toolName: "browser_click", action: 'clicking button "Place order"', signal: undefined },
  ]);
});

test("without an approver (headless, standalone, a test run) the stop stands; a no or a failing approver denies", async () => {
  const none = setup(PAY);
  assert.match((await none.run("browser_click", { ref: "e1" })).note ?? "", STOPPED);

  const no = setup(PAY, undefined, { askApproval: async () => false });
  assert.match((await no.run("browser_click", { ref: "e1" })).note ?? "", STOPPED);
  const down = setup(PAY, undefined, { askApproval: async () => Promise.reject(new Error("No Pista window is connected")) });
  assert.match((await down.run("browser_click", { ref: "e1" })).note ?? "", STOPPED);
  assert.deepEqual([...no.inputs, ...down.inputs], []);
});

test("an ordinary click is not asked about", async () => {
  const s = setup({ kind: "button", name: "Search" }, undefined, { askApproval: async () => assert.fail("asked") });
  assert.equal((await s.run("browser_click", { ref: "e1" })).note, undefined);
  assert.equal(s.inputs.length, 1);
});

test("pressing Enter in a field of a payment form stops, as does Enter or Space on a focused pay button; other keys do not", async () => {
  const field = setup({}, { kind: "input", name: "Card number", submitName: "Pay now" });
  assert.match((await field.run("browser_press", { key: "Enter" })).note ?? "", /^Stopped: pressing Enter, which would press button "Pay now" looks like a consequential action .* Enter was not pressed\./);
  assert.deepEqual(field.inputs, []);
  assert.equal((await field.run("browser_press", { key: "Escape" })).note, undefined);

  const button = setup({}, { kind: "button", name: "Pay now" });
  assert.match((await button.run("browser_press", { key: "Enter" })).note ?? "", /^Stopped: pressing Enter on button "Pay now"/);
  assert.match((await button.run("browser_press", { key: "Space" })).note ?? "", /^Stopped: pressing Space on button "Pay now"/);
  assert.deepEqual(button.inputs, []);

  const approved = setup({}, { kind: "input", name: "Card number", submitName: "Pay now" }, { askApproval: async () => true });
  assert.equal((await approved.run("browser_press", { key: "Enter" })).note, undefined);
  assert.deepEqual(approved.inputs, [{ type: "key", key: "Enter" }]);

  const search = setup({}, { kind: "input", name: "Search", submitName: "Search" });
  assert.equal((await search.run("browser_press", { key: "Enter" })).note, undefined);
});

test("browser_type with submit types but holds Enter on a consequential submit button until the user approves", async () => {
  const s = setup({ kind: "input", name: "Card", submitName: "Pay now" });
  const held = await s.run("browser_type", { ref: "e1", text: "4242", submit: true });
  assert.match(held.note ?? "", /^Stopped: pressing Enter, which would press button "Pay now" .* The text was typed but the form was not submitted\./);
  assert.deepEqual(s.inputs, [{ type: "click", x: 5, y: 5 }, { type: "text", text: "4242" }]);

  const ok = setup({ kind: "input", name: "Card", submitName: "Pay now" }, undefined, { askApproval: async () => true });
  assert.equal((await ok.run("browser_type", { ref: "e1", text: "4242", submit: true })).note, undefined);
  assert.deepEqual(ok.inputs.at(-1), { type: "key", key: "Enter" });
});

test("browser_press fails closed when the focused element cannot be inspected, and Control+Enter counts as Enter", async () => {
  const failing = setup({}, () => undefined as never);
  assert.match((await failing.run("browser_press", { key: "Enter" })).note ?? "", /^Stopped: pressing Enter on an element that could not be inspected looks like a consequential action/);
  assert.match((await failing.run("browser_press", { key: "Space" })).note ?? "", /^Stopped: pressing Space on an element that could not be inspected/);
  assert.equal((await failing.run("browser_press", { key: "Escape" })).note, undefined);
  const frame = setup({}, { unreadable: true });
  assert.match((await frame.run("browser_press", { key: "Enter" })).note ?? "", /could not be inspected/);
  assert.deepEqual(frame.inputs, []);
  const chord = setup({}, { kind: "input", name: "Card", submitName: "Pay now" });
  assert.match((await chord.run("browser_press", { key: "Control+Enter" })).note ?? "", /would press button "Pay now"/);
  const area = setup({}, { kind: "textarea", name: "Message" });
  assert.equal((await area.run("browser_press", { key: "Enter" })).note, undefined);
});

test("after a yes the target is looked at again: a control that changed meanwhile is not clicked, typed into or pressed", async () => {
  let calls = 0;
  const swapped = () => (++calls > 1 ? { kind: "button", name: "Delete account" } : PAY);
  const click = setup(swapped, undefined, { askApproval: async () => true });
  const meta = await click.run("browser_click", { ref: "e1" });
  assert.match(meta.note ?? "", /^Stopped: the page changed while the user was deciding, so their approval no longer applies to clicking button "Place order"\. Nothing was clicked\./);
  assert.deepEqual(click.inputs, []);

  let n = 0;
  const gone = setup(() => (++n > 1 ? { error: "Ref e1 is not on the page (anymore)." } : PAY), undefined, { askApproval: async () => true });
  assert.match((await gone.run("browser_click", { ref: "e1" })).note ?? "", /page changed while the user was deciding/);
  assert.deepEqual(gone.inputs, []);

  let m = 0;
  const type = setup(() => (++m > 1 ? { kind: "input", name: "Card", submitName: "Delete account" } : { kind: "input", name: "Card", submitName: "Pay now" }), undefined, { askApproval: async () => true });
  assert.match((await type.run("browser_type", { ref: "e1", text: "4242", submit: true })).note ?? "", /page changed while the user was deciding.* Nothing was typed\./);
  assert.deepEqual(type.inputs, []);

  let k = 0;
  const press = setup({}, () => (++k > 1 ? { kind: "button", name: "Delete account" } : { kind: "button", name: "Pay now" }), { askApproval: async () => true });
  assert.match((await press.run("browser_press", { key: "Enter" })).note ?? "", /page changed while the user was deciding.*Enter was not pressed\./);
  assert.deepEqual(press.inputs, []);
});

test("a yes that arrives after the run was stopped does nothing, and the ask gets the run's signal", async () => {
  const stop = new AbortController();
  let seen: AbortSignal | undefined;
  const s = setup(PAY, undefined, {
    askApproval: async ({ signal }) => {
      seen = signal;
      stop.abort();
      return true;
    },
  });
  assert.match((await s.run("browser_click", { ref: "e1" }, stop.signal)).note ?? "", ABORTED);
  assert.equal(seen, stop.signal);
  assert.deepEqual(s.inputs, []);
  // Already aborted before the stop: the user is not even asked.
  const asked = setup(PAY, undefined, { askApproval: async () => assert.fail("asked") });
  assert.match((await asked.run("browser_click", { ref: "e1" }, AbortSignal.abort())).note ?? "", ABORTED);
});

test("key aliases cannot slip past the press stop: Return, return, Control+Return and Spacebar count as Enter and Space, and the driver gets the canonical name", async () => {
  const field = { kind: "input", name: "Card number", submitName: "Pay now" };
  for (const key of ["Return", "return", "ENTER", "Control+Return", "Meta+return"]) {
    const s = setup({}, field);
    assert.match((await s.run("browser_press", { key })).note ?? "", /^Stopped: pressing Enter, which would press button "Pay now"/, key);
    assert.deepEqual(s.inputs, [], key);
  }
  const button = setup({}, { kind: "button", name: "Pay now" });
  assert.match((await button.run("browser_press", { key: "Spacebar" })).note ?? "", /^Stopped: pressing Space on button "Pay now"/);
  assert.deepEqual(button.inputs, []);
  // Once approved, the key goes to the driver in its canonical spelling.
  const approved = setup({}, field, { askApproval: async () => true });
  await approved.run("browser_press", { key: "Control+Return" });
  await approved.run("browser_press", { key: "Escape" });
  assert.deepEqual(approved.inputs.map((i) => i.key), ["Control+Enter", "Escape"]);
});

test("a stopped run performs no click and types nothing when the approval ask ends in an abort; a plain no still types without submitting", async () => {
  const stop = new AbortController();
  const aborted = setup({ kind: "input", name: "Query", submitName: "Place order" }, undefined, { askApproval: async () => (stop.abort(), true) });
  const note = (await aborted.run("browser_type", { ref: "e1", text: "abc", submit: true }, stop.signal)).note ?? "";
  assert.match(note, /^Stopped: the run was stopped while the user was being asked about pressing Enter, which would press button "Place order"\. Nothing was typed\./);
  assert.deepEqual(aborted.inputs, [], "no click, no text, no Enter");
  // Aborted before the ask: the user is not asked, and nothing happens.
  const early = setup({ kind: "input", name: "Query", submitName: "Place order" }, undefined, { askApproval: async () => assert.fail("asked") });
  assert.match((await early.run("browser_type", { ref: "e1", text: "abc", submit: true }, AbortSignal.abort())).note ?? "", /^Stopped: the run was stopped/);
  assert.deepEqual(early.inputs, []);
  // A plain no keeps today's behaviour, and says so.
  const denied = setup({ kind: "input", name: "Query", submitName: "Place order" }, undefined, { askApproval: async () => false });
  assert.match((await denied.run("browser_type", { ref: "e1", text: "abc", submit: true })).note ?? "", /needs the user's approval, which was not given\. The text was typed but the form was not submitted\./);
  assert.deepEqual(denied.inputs.map((i) => i.type), ["click", "text"]);
  // The same for a held click and a held key press.
  const click = setup(PAY, undefined, { askApproval: async () => (stop.signal.aborted ? assert.fail() : true) });
  assert.match((await click.run("browser_click", { ref: "e1" }, stop.signal)).note ?? "", /^Stopped: the run was stopped/);
  assert.deepEqual(click.inputs, []);
});

test("the action text shown to the user is sanitized: control and bidi characters dropped, quotes escaped, kind and total capped", async () => {
  const asked: string[] = [];
  const name = 'Pay\u202E now\u0000 "fake" \\ \n' + "x".repeat(400);
  const s = setup({ kind: "button" + "z".repeat(40), name }, undefined, { askApproval: async (r) => (asked.push(r.action), false) });
  const note = (await s.run("browser_click", { ref: "e1" })).note ?? "";
  const action = asked[0]!;
  assert.ok(action.length <= 160, `${action.length} chars`);
  assert.match(action, /^clicking buttonz{13}… "Pay now \\"fake\\" \\\\ x+…"$/);
  assert.ok(!/[\u0000-\u001f\u202e]/.test(action));
  assert.ok(note.includes(action));
});
