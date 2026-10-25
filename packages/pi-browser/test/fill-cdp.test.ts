import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { registerBrowserTools } from "../src/tools.ts";

// browser_fill is on by default (PI_BROWSER_FILL=0 turns it off); the flag is read when the tools are registered.
// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
type Tool = { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> };
let server: Server;
let driver: CdpDriver | undefined;
let base = "";
const on = new Map<string, Tool>();
const off = new Map<string, Tool>();

const register = (tools: Map<string, Tool>, flag: string | undefined) => {
  if (flag === undefined) delete process.env.PI_BROWSER_FILL;
  else process.env.PI_BROWSER_FILL = flag;
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver!, { keepPageViews: 0 });
  delete process.env.PI_BROWSER_FILL;
};
const call = async (name: string, params: Record<string, unknown> = {}) => {
  const res = await on.get(name)!.execute("t", params);
  return { meta: JSON.parse(res.content[0]!.text!) as { url?: string; title?: string; result?: string; note?: string }, body: res.content[1]?.text ?? "" };
};
/** Opens the fill form and returns the refs of its controls. */
const open = async () => {
  await call("browser_navigate", { url: `${base}fill.html` });
  const snap = (await call("browser_snapshot")).body;
  const ref = (pattern: RegExp) => snap.match(pattern)?.[1] ?? assert.fail(`${pattern} not in\n${snap}`);
  return {
    from: ref(/\[(e\d+)\] textbox "From"/),
    notes: ref(/\[(e\d+)\] textbox "Notes"/),
    cabin: ref(/\[(e\d+)\] combobox "Cabin class"/),
    flex: ref(/\[(e\d+)\] checkbox "Flexible dates"/),
    veg: ref(/\[(e\d+)\] radio "Vegetarian"/),
    dest: ref(/\[(e\d+)\] combobox "Destination"/),
    pw: ref(/\[(e\d+)\] textbox[^ ]* "Password"/),
    search: ref(/\[(e\d+)\] button "Search"/),
  };
};
const value = (sel: string) => driver!.evaluate(`document.querySelector(${JSON.stringify(sel)}).value`);

before(async () => {
  if (skip) return;
  const root = join(import.meta.dirname, "fixture");
  server = createServer((req, res) => {
    try {
      const body = readFileSync(join(root, new URL(req.url ?? "/", "http://x").pathname.replace(/\/$/, "/index.html")));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  driver = new CdpDriver(CDP);
  register(on, undefined);
  register(off, "0");
});
after(() => {
  driver?.close();
  server?.close();
  server?.closeAllConnections(); // Chrome keeps its connections alive, which would hold the process open
});

test("the tool is present by default and absent with PI_BROWSER_FILL=0", { skip }, () => {
  assert.ok(on.has("browser_fill"));
  assert.ok(!off.has("browser_fill"));
  assert.ok(off.has("browser_type"));
});

test("fills text, textarea, select, checkbox, radio and a combobox, reads each back, then submits", { skip }, async () => {
  const f = await open();
  const res = await call("browser_fill", {
    fields: [
      { ref: f.from, value: "Stockholm" },
      { ref: f.notes, value: "Window seat" },
      { ref: f.cabin, value: "Business" },
      { ref: f.flex, value: "true" },
      { ref: f.veg, value: "Vegetarian" },
      { ref: f.dest, value: "Lisbon" },
    ],
    submit: f.search,
  });
  const lines = res.meta.result!.split("\n");
  assert.deepEqual(lines.slice(0, 6), [
    'From = "Stockholm" ✓',
    'Notes = "Window seat" ✓',
    'Cabin class = "Business" ✓',
    "Flexible dates = checked ✓",
    "Vegetarian = checked ✓",
    'Destination = "Lisbon" ✓',
  ]);
  assert.match(lines[6]!, /^Submit: Clicked button "Search"\. Page: .*fill\.html .* -> .*result\.html\?/);
  assert.equal(lines[7], "Filled 6/6 fields. Submitted.");
  assert.equal(res.meta.note, undefined);
  assert.match(res.meta.url!, /\/result\.html\?from=Stockholm&notes=Window\+seat&cabin=Business&flex=on&meal=veg&dest=Lisbon&pw=$/);
  assert.match(res.body, /interactive elements/);
});

test("the first failing field stops the batch: later fields are untouched and nothing is submitted", { skip }, async () => {
  const f = await open();
  const res = await call("browser_fill", {
    fields: [
      { ref: f.from, value: "Stockholm" },
      { ref: f.dest, value: "Atlantis" },
      { ref: f.notes, value: "never typed" },
    ],
    submit: f.search,
  });
  const lines = res.meta.result!.split("\n");
  assert.equal(lines[0], 'From = "Stockholm" ✓');
  assert.match(lines[1]!, /^Destination: typed "Atlantis", suggestion not chosen.* ✗$/);
  assert.equal(lines.at(-1), "Filled 1/3 fields; stopped at field 2 (Destination). Not submitted.");
  assert.equal(lines.length, 3);
  assert.match(res.meta.url!, /\/fill\.html$/, "still on the form");
  assert.equal(await value("#notes"), "");
  assert.equal(await value("#from"), "Stockholm");
});

test("a secret field is refused with browser_type's hand-back, its value never echoed, and the batch stops", { skip }, async () => {
  const f = await open();
  const res = await call("browser_fill", {
    fields: [
      { ref: f.from, value: "Stockholm" },
      { ref: f.pw, value: "hunter2-secret" },
      { ref: f.notes, value: "never typed" },
    ],
    submit: f.search,
  });
  const lines = res.meta.result!.split("\n");
  assert.equal(lines[0], 'From = "Stockholm" ✓');
  assert.match(lines[1]!, /^Password: secret field, not typed .* ✗$/);
  assert.equal(lines.at(-1), "Filled 1/3 fields; stopped at field 2 (Password). Not submitted.");
  assert.match(res.meta.note!, /^Not typed: .* is a password or other secret field .* Nothing was entered\. Ask the user to type it themselves/);
  assert.doesNotMatch(JSON.stringify(res), /hunter2/);
  assert.equal(await value("#pw"), "");
  assert.equal(await value("#notes"), "");
  assert.match(res.meta.url!, /\/fill\.html$/);
});

test("a radio value naming another option of its group checks that option; a radio cannot be unchecked", { skip }, async () => {
  const f = await open();
  const res = await call("browser_fill", { fields: [{ ref: f.veg, value: "Standard" }, { ref: f.veg, value: "false" }] });
  const lines = res.meta.result!.split("\n");
  assert.equal(lines[0], 'Vegetarian = "Standard" ✓');
  assert.match(lines[1]!, /^Vegetarian: a radio button cannot be unchecked.* ✗$/);
  assert.equal(await driver!.evaluate(`document.querySelector("[name=meal]:checked").value`), "std");
});

test("a consequential submit is held like a click: the fields are filled, the form is not submitted", { skip }, async () => {
  const f = await open();
  await driver!.evaluate(`document.querySelector("button[type=submit]").textContent = "Place order"`);
  const res = await call("browser_fill", { fields: [{ ref: f.from, value: "Oslo" }], submit: f.search });
  const lines = res.meta.result!.split("\n");
  assert.equal(lines[0], 'From = "Oslo" ✓');
  assert.match(lines[1]!, /^Submit: Stopped: clicking button "Place order" .* ✗$/);
  assert.equal(lines.at(-1), "Filled 1/1 fields. Not submitted.");
  assert.match(res.meta.note!, /needs the user's approval, which was not given/);
  assert.match(res.meta.url!, /\/fill\.html$/);
});
