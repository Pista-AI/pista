import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { registerBrowserTools } from "../src/tools.ts";

// browser_choose is opt-in; the flag is read when the tools are registered.
// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers.
const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);

type Tool = { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> };
const register = (driver: CdpDriver, askApproval?: (r: { action: string }) => Promise<boolean>) => {
  const tools = new Map<string, Tool>();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver, { keepPageViews: 0, askApproval });
  return tools;
};
let server: Server;
let driver: CdpDriver | undefined;
let base = "";
let tools = new Map<string, Tool>();
let approvedTools = new Map<string, Tool>();
const call = async (name: string, params: Record<string, unknown> = {}, from = tools) => {
  const res = await from.get(name)!.execute("t", params);
  return { meta: JSON.parse(res.content[0]!.text!) as { url?: string; result?: string; note?: string }, body: res.content[1]?.text ?? "" };
};
const open = async () => {
  await call("browser_navigate", { url: `${base}choose.html` });
  const snap = (await call("browser_snapshot")).body;
  return (pattern: RegExp) => snap.match(pattern)?.[1] ?? assert.fail(`${pattern} not in\n${snap}`);
};
const field = (id: string) => driver!.evaluate(`document.getElementById(${JSON.stringify(id)}).value`);

before(async () => {
  if (skip) return;
  process.env.PI_BROWSER_CHOOSE = "1";
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
  tools = register(driver);
  approvedTools = register(driver, async () => true);
});
after(() => {
  delete process.env.PI_BROWSER_CHOOSE;
  driver?.close();
  server?.close();
  server?.closeAllConnections(); // Chrome keeps its connections alive, which would hold the process open
});

test("the tool is absent unless PI_BROWSER_CHOOSE=1", () => {
  const saved = process.env.PI_BROWSER_CHOOSE;
  try {
    delete process.env.PI_BROWSER_CHOOSE;
    const off = new Map<string, Tool>();
    registerBrowserTools({ registerTool: (t: { name: string }) => off.set(t.name, t as never), on: () => {} } as never, () => ({}) as never, { keepPageViews: 0 });
    assert.ok(off.has("browser_click"));
    assert.equal(off.has("browser_choose"), false);
    process.env.PI_BROWSER_CHOOSE = "1";
    const on = new Map<string, Tool>();
    registerBrowserTools({ registerTool: (t: { name: string }) => on.set(t.name, t as never), on: () => {} } as never, () => ({}) as never, { keepPageViews: 0 });
    assert.ok(on.has("browser_choose"));
  } finally {
    if (saved === undefined) delete process.env.PI_BROWSER_CHOOSE;
    else process.env.PI_BROWSER_CHOOSE = saved;
  }
});

test("choose commits a value in an ARIA combobox whose list arrives after 300 ms", { skip }, async () => {
  const ref = await open();
  const res = await call("browser_choose", { ref: ref(/\[(e\d+)\] combobox "Where to\?"/), text: "Barcelona" });
  assert.equal(res.meta.result, 'Chose "Barcelona, Spain" in combobox "Where to?". The field now shows "Barcelona".');
  assert.equal(await field("dest"), "Barcelona");
  assert.equal(await driver!.evaluate("document.getElementById('dest').dataset.committed"), "Barcelona, Spain");
  assert.match(res.body, /combobox "Where to\?" value="Barcelona"/); // the usual fresh snapshot follows
});

test("choose matches without regard to case or accents, and can be repeated on a filled field", { skip }, async () => {
  const ref = await open();
  const e = ref(/\[(e\d+)\] combobox "Where to\?"/);
  assert.match((await call("browser_choose", { ref: e, text: "BERLIN" })).meta.result!, /^Chose "Berlin, Germany"/);
  const res = await call("browser_choose", { ref: e, text: "malaga" });
  assert.match(res.meta.result!, /^Chose "Málaga, Spain" in combobox "Where to\?"\. The field now shows "Málaga"\.$/);
  assert.equal(await field("dest"), "Málaga");
});

test("choose finds a listbox that is not linked by aria-controls, and holds an option that looks consequential", { skip }, async () => {
  const ref = await open();
  const e = ref(/\[(e\d+)\] combobox "Command"/);
  const held = await call("browser_choose", { ref: e, text: "delete" });
  assert.match(held.meta.note!, /Stopped: clicking element "Delete account"/);
  assert.equal(held.meta.result, undefined);
  assert.equal(await driver!.evaluate("document.getElementById('cmd').dataset.committed ?? ''"), "");
  const ref2 = await open();
  const ok = await call("browser_choose", { ref: ref2(/\[(e\d+)\] combobox "Command"/), text: "delete" }, approvedTools);
  assert.match(ok.meta.result!, /^Chose "Delete account" in combobox "Command"/);
  const plain = await open();
  const help = await call("browser_choose", { ref: plain(/\[(e\d+)\] combobox "Command"/), text: "help" });
  assert.match(help.meta.result!, /^Chose "Show help"/);
});

test("choose commits a value from an <input list> datalist", { skip }, async () => {
  const ref = await open();
  const res = await call("browser_choose", { ref: ref(/\[(e\d+)\] [a-z:]+ "Fruit"/), text: "bana" });
  assert.match(res.meta.result!, /^Chose "Banana" in [a-z:]+ "Fruit"\. The field now shows "Banana"\.$/);
  assert.equal(await field("fruit"), "Banana");
});

test("choose picks an option in a native select, and a no-match lists the options", { skip }, async () => {
  const ref = await open();
  const e = ref(/\[(e\d+)\] combobox "Country"/);
  const miss = await call("browser_choose", { ref: e, text: "atlantis" });
  assert.equal(miss.meta.result, 'No option matched "atlantis"; options were: Sweden, Norway, Denmark.');
  assert.equal(await field("country"), "");
  const res = await call("browser_choose", { ref: e, text: "norw" });
  assert.equal(res.meta.result, 'Chose "Norway" in combobox "Country". The field now shows "Norway".');
  assert.equal(await field("country"), "no");
});

test("choose says so when no suggestions appear", { skip }, async () => {
  const ref = await open();
  const res = await call("browser_choose", { ref: ref(/\[(e\d+)\] combobox "Where to\?"/), text: "zzzz" });
  assert.match(res.meta.result!, /^No suggestions appeared after typing "zzzz" in combobox "Where to\?"/);
  assert.equal(await field("dest"), "zzzz");
});

test("choose reports the options when none matches the text", { skip }, async () => {
  const ref = await open();
  const res = await call("browser_choose", { ref: ref(/\[(e\d+)\] combobox "Command"/), text: "xyz" }, approvedTools);
  assert.equal(res.meta.result, 'No option matched "xyz"; options were: Open settings, Delete account, Show help.');
});

test("choose never types into a secret field", { skip }, async () => {
  const ref = await open();
  const res = await call("browser_choose", { ref: ref(/\[(e\d+)\] combobox "Card number"/), text: "4111111111111111" });
  assert.match(res.meta.note!, /secret field.*Nothing was entered/);
  assert.doesNotMatch(`${res.meta.note}\n${res.body}`, /4111/);
  assert.equal(await field("card"), "");
});

test("choose falls back to ArrowDown and Enter when clicking an option does not commit it", { skip }, async () => {
  const ref = await open();
  const res = await call("browser_choose", { ref: ref(/\[(e\d+)\] combobox "Keys only"/), text: "gre" });
  assert.equal(res.meta.result, 'Chose "Green" in combobox "Keys only". The field now shows "Green".');
  assert.equal(await field("keys"), "Green");
});
