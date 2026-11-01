// Serves test/fixture on http://127.0.0.1:8765 until stopped: `pnpm --filter @pista/pi-browser exec tsx test/serve-fixtures.ts`
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(import.meta.dirname, "fixture");
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
createServer((req, res) => {
  const path = normalize(new URL(req.url ?? "/", "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(8765, "127.0.0.1", () => console.log("fixtures on http://127.0.0.1:8765"));
