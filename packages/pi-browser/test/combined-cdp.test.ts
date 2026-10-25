import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { BrowserDriver } from "../src/driver.ts";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { scripts } from "../src/page-scripts.ts";
import { registerBrowserTools } from "../src/tools.ts";

// The flags PI_BROWSER_DELTA (default on), PI_BROWSER_CHOOSE (default off) and PI_BROWSER_FILL (default on) in every combination of delta and choose, with fill on:
// browser_fill must still work when its snapshot stub is needed (delta off) and when refs are stable (delta on), and with
// PI_BROWSER_CHOOSE=1 its combobox goes through browser_choose's logic.
// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
type Tool = { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> };
let server: Server;
let cdp: CdpDriver | undefined;
let base = "";
let snapshots = 0;
const SNAP_SCRIPTS = new Set([scripts.snapshot(150), scripts.snapshot(150, false, true)]);
/** The CDP driver, counting the page snapshots that reach it. */
const counting = (): BrowserDriver => {
  const d = cdp!;
  return {
    navigate: (u) => d.navigate(u),
    state: () => d.state(),
    back: () => d.back(),
    reload: () => d.reload(),
    evaluate: (s) => (SNAP_SCRIPTS.has(s) && snapshots++, d.evaluate(s)),
    input: (e) => d.input(e),
    screenshot: () => d.screenshot(),
    setActivity: (l) => d.setActivity?.(l),
  };
};

const FLAGS = ["PI_BROWSER_DELTA", "PI_BROWSER_CHOOSE", "PI_BROWSER_FILL"] as const;
const setup = (delta: boolean, choose: boolean) => {
  const tools = new Map<string, Tool>();
  const saved = FLAGS.map((f) => process.env[f]);
  process.env.PI_BROWSER_FILL = "1";
  for (const [flag, on] of [["PI_BROWSER_DELTA", delta], ["PI_BROWSER_CHOOSE", choose]] as const) {
    if (on) process.env[flag] = "1";
    else if (flag === "PI_BROWSER_DELTA") process.env[flag] = "0";
    else delete process.env[flag];
  }
  const d = counting();
  registerBrowserTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as never, () => d, { keepPageViews: 0 });
  FLAGS.forEach((f, i) => (saved[i] === undefined ? delete process.env[f] : (process.env[f] = saved[i])));
  return tools;
};
/** Tools are called with the flags set as they were at registration; delta and choose are also read at call time, so set them around each call. */
const caller = (tools: Map<string, Tool>, delta: boolean, choose: boolean) => async (name: string, params: Record<string, unknown> = {}) => {
  const saved = FLAGS.map((f) => process.env[f]);
  process.env.PI_BROWSER_FILL = "1";
  for (const [flag, on] of [["PI_BROWSER_DELTA", delta], ["PI_BROWSER_CHOOSE", choose]] as const) {
    if (on) process.env[flag] = "1";
    else if (flag === "PI_BROWSER_DELTA") process.env[flag] = "0";
    else delete process.env[flag];
  }
  try {
    const res = await tools.get(name)!.execute("t", params);
    return { meta: JSON.parse(res.content[0]!.text!) as { url?: string; title?: string; result?: string; note?: string }, body: res.content[1]?.text ?? "" };
  } finally {
    FLAGS.forEach((f, i) => (saved[i] === undefined ? delete process.env[f] : (process.env[f] = saved[i])));
  }
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
  cdp = new CdpDriver(CDP);
});
after(() => {
  cdp?.close();
  server?.close();
  server?.closeAllConnections();
});

for (const delta of [false, true]) {
  for (const choose of [false, true]) {
    const name = `delta ${delta ? "on" : "off"}, choose ${choose ? "on" : "off"}`;
    test(`browser_fill fills a form, takes one snapshot, and stops on a failing combobox (${name})`, { skip }, async () => {
      const call = caller(setup(delta, choose), delta, choose);
      await call("browser_navigate", { url: `${base}fill.html` });
      const snap = (await call("browser_snapshot")).body;
      const ref = (p: RegExp) => snap.match(p)?.[1] ?? assert.fail(`${p} not in\n${snap}`);
      const f = { from: ref(/\[(e\d+)\] textbox "From"/), notes: ref(/\[(e\d+)\] textbox "Notes"/), dest: ref(/\[(e\d+)\] combobox "Destination"/), cabin: ref(/\[(e\d+)\] combobox "Cabin class"/) };

      snapshots = 0;
      const ok = await call("browser_fill", { fields: [{ ref: f.from, value: "Stockholm" }, { ref: f.cabin, value: "Business" }, { ref: f.dest, value: "Lisbon" }] });
      assert.deepEqual(ok.meta.result!.split("\n"), ['From = "Stockholm" ✓', 'Cabin class = "Business" ✓', 'Destination = "Lisbon" ✓', "Filled 3/3 fields."]);
      assert.equal(snapshots, 1, "only the closing snapshot reaches the page; the per-field ones are stubbed");
      if (delta) assert.match(ok.body, /Page changed|No interactive elements/, "the closing view is a delta");
      else assert.match(ok.body, /interactive elements\./);

      // Refs from the model's last view must still name the same fields afterwards (stable refs, or the stub kept them untouched).
      const again = await call("browser_fill", { fields: [{ ref: f.notes, value: "Window seat" }, { ref: f.dest, value: "Atlantis" }] });
      const lines = again.meta.result!.split("\n");
      assert.equal(lines[0], 'Notes = "Window seat" ✓');
      assert.match(lines[1]!, /^Destination: .*Atlantis.* ✗$/);
      assert.equal(lines.at(-1), "Filled 1/2 fields; stopped at field 2 (Destination).");
      assert.equal(await cdp!.evaluate("document.querySelector('#notes').value"), "Window seat");
    });
  }
}

test("browser_choose with delta on keeps refs stable and answers with a delta or a full snapshot that still names the same fields", { skip }, async () => {
  const tools = setup(true, true);
  const call = caller(tools, true, true);
  await call("browser_navigate", { url: `${base}fill.html` });
  const snap = (await call("browser_snapshot")).body;
  const dest = snap.match(/\[(e\d+)\] combobox "Destination"/)?.[1] ?? assert.fail(snap);
  const from = snap.match(/\[(e\d+)\] textbox "From"/)?.[1] ?? assert.fail(snap);
  const res = await call("browser_choose", { ref: dest, text: "Lyon" });
  assert.match(res.meta.result!, /^Chose "Lyon"/);
  assert.match(res.body, /Page changed|No interactive elements|interactive elements\./);
  // The same ref still reaches the same field, which a renumbering snapshot would have broken.
  const typed = await call("browser_type", { ref: from, text: "Oslo" });
  assert.equal(typed.meta.note, undefined);
  assert.equal(await cdp!.evaluate("document.querySelector('#from').value"), "Oslo");
  assert.equal(await cdp!.evaluate("document.querySelector('#dest').value"), "Lyon");
});
