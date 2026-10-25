import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { registerBrowserTools } from "../src/tools.ts";

// Effect feedback is opt-in; these tests exercise it.
process.env.PI_BROWSER_EFFECT_FEEDBACK = "1";

// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
let server: Server;
let driver: CdpDriver | undefined;
let base = "";
const tools = new Map<string, { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> }>();
const call = async (name: string, params: Record<string, unknown> = {}) => {
  const res = await tools.get(name)!.execute("t", params);
  return { meta: JSON.parse(res.content[0]!.text!) as { url?: string; result?: string; note?: string }, body: res.content[1]?.text ?? "" };
};
/** Navigates to the widgets fixture and returns a ref finder for its snapshot. */
const open = async () => {
  await call("browser_navigate", { url: `${base}widgets.html` });
  const snap = (await call("browser_snapshot")).body;
  return { snap, ref: (pattern: RegExp) => snap.match(pattern)?.[1] ?? assert.fail(`${pattern} not in\n${snap}`) };
};

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
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => driver!, { keepPageViews: 0 });
});
after(() => {
  driver?.close();
  server?.close();
  server?.closeAllConnections(); // Chrome keeps its connections alive, which would hold the process open
});

test("typing into a combobox reports the open list as not committed; picking an option commits it", { skip }, async () => {
  const { ref } = await open();
  const typed = await call("browser_type", { ref: ref(/\[(e\d+)\] combobox "Where to\?"/), text: "B" });
  assert.match(typed.meta.result!, /The field shows "B" \(was empty\)\./);
  assert.match(typed.meta.result!, /suggestion list is open with 5 options; the value is not committed yet/);
  const option = typed.body.match(/\[(e\d+)\] option "Barcelona"/)?.[1] ?? assert.fail(typed.body);
  const picked = await call("browser_click", { ref: option });
  assert.match(picked.meta.result!, /The list closed\./);
  assert.match(picked.body, /combobox "Where to\?" value="Barcelona"/);
});

test("a click that changes nothing says there was no visible change", { skip }, async () => {
  const { ref } = await open();
  const res = await call("browser_click", { ref: ref(/\[(e\d+)\] button "Do nothing"/) });
  assert.equal(res.meta.result, 'Clicked button "Do nothing". No visible change yet.');
});

test("a card number field without an autocomplete attribute is never typed into, echoed or shown in the snapshot", { skip }, async () => {
  const { ref } = await open();
  const res = await call("browser_type", { ref: ref(/\[(e\d+)\] textbox "Payment"/), text: "4111111111111111" });
  assert.match(res.meta.note!, /secret field.*Nothing was entered/);
  assert.doesNotMatch(`${res.meta.note}\n${res.body}`, /4111/);
  assert.equal(await driver.evaluate("document.getElementById('pay').value"), "");
  assert.match((await call("browser_snapshot")).body, /textbox "Payment" empty/);
  await driver.evaluate("document.getElementById('pay').value = '4111111111111111'");
  const snap = (await call("browser_snapshot")).body;
  assert.match(snap, /textbox "Payment" value="•••"/);
  assert.doesNotMatch(snap, /4111/);
});

test("a link click reports the URL change; a toggle button reports its list", { skip }, async () => {
  const { ref, snap } = await open();
  assert.match(snap, /button "Menu" \[collapsed\]/);
  assert.match(snap, /…\[\+N chars\] = text was cut/);
  assert.match(snap, /link "Näckrosen .*…\[\+\d+ chars\]"/);
  const menu = await call("browser_click", { ref: ref(/\[(e\d+)\] button "Menu"/) });
  assert.match(menu.meta.result!, /A list is open\./);
  assert.match(menu.body, /button "Menu" \[expanded\]/);
  const link = await call("browser_click", { ref: ref(/\[(e\d+)\] link "About us"/) });
  assert.match(link.meta.result!, /^Clicked a "About us"\. URL changed \(was \/widgets\.html\)\. Title is now /);
  assert.match(link.meta.url!, /\/about\.html$/);
});
