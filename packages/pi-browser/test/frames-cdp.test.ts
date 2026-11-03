import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { registerBrowserTools } from "../src/tools.ts";

// Needs a running headless Chrome (PI_BROWSER_CDP_URL, default http://127.0.0.1:9223); skips cleanly when none answers. This test never starts one.
const CDP = process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9223";
const skip: string | false = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => false as const, () => `no Chrome answers at ${CDP}`);
let server: Server;
let driver: CdpDriver | undefined;
let base = "";
const tools = new Map<string, { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text?: string }[] }> }>();
const call = async (name: string, params: Record<string, unknown> = {}) => {
  const res = await tools.get(name)!.execute("t", params);
  return res.content[1]?.text ?? "";
};

before(async () => {
  if (skip) return;
  const root = join(import.meta.dirname, "fixture");
  server = createServer((req, res) => {
    try {
      const body = readFileSync(join(root, new URL(req.url ?? "/", "http://x").pathname));
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
  server?.closeAllConnections();
});

test("a page whose content is in a large iframe: snapshot and read name the frame, count the small ones and hint at its URL", { skip }, async () => {
  await call("browser_navigate", { url: `${base}frames.html` });
  const hint = `Main content appears to be in an iframe ${base}about.html; call browser_navigate to that URL to work with it.`;
  const list = `Frames (not included in this view):\n  800x600 ${base}about.html\n  +2 small/hidden frames`;
  const snap = await call("browser_snapshot");
  assert.ok(snap.split("\n")[0]!.includes(hint), snap);
  assert.ok(snap.endsWith(list), snap);
  const read = await call("browser_read");
  assert.ok(read.startsWith(hint), read);
  assert.ok(read.endsWith(list), read);
});
