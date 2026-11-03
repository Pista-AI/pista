// Serves test/fixture on http://127.0.0.1:8765 until stopped: `pnpm --filter @pista/pi-browser exec tsx test/serve-fixtures.ts`
// Invoice site (fixture/invoices/): login -> home -> billing (iframe of list.html) -> list.html with a download link to inv-001.pdf.
// GET /__fixture/label?text=Get%20PDF changes the download link's label in list.html without changing its address.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(import.meta.dirname, "fixture");
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".pdf": "application/pdf" };
let label = "Download invoice";
/** A tiny valid one-page PDF, built rather than committed. */
function tinyPdf(): Buffer {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/__fixture/label") {
    label = url.searchParams.get("text") || "Download invoice";
    return void res.writeHead(200).end(label);
  }
  const path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  if (path === "/invoices/inv-001.pdf") return void res.writeHead(200, { "content-type": "application/pdf" }).end(tinyPdf());
  try {
    const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
    const body = readFileSync(file);
    const out = path === "/invoices/list.html" ? Buffer.from(body.toString("utf8").replaceAll("{{LABEL}}", label.replace(/[<>&"]/g, ""))) : body;
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(out);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(8765, "127.0.0.1", () => console.log("fixtures on http://127.0.0.1:8765"));
