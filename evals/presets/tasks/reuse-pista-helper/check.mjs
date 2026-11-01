// Hidden check: behaviour of logUrl, plus a static look that it reuses maskUserinfo from network.ts instead of copying it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const file = "apps/host/src/log-url.ts";
let src = "";
try { src = readFileSync(file, "utf8"); } catch { console.error("BEHAVIOUR WRONG: no " + file); process.exit(1); }
const fails = [];
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
if (!/import\s*\{[^}]*\bmaskUserinfo\b[^}]*\}\s*from\s*["']\.\/network(\.ts)?["']/.test(src)) fails.push("NOT REUSED: log-url.ts does not import maskUserinfo from ./network");
if (/\.(username|password)\s*=[^=]/.test(code) || code.includes("***")) fails.push("DUPLICATED: log-url.ts masks credentials itself");
// network.ts needs undici at import time; the workspace has no node_modules, so a stub stands in.
mkdirSync("node_modules/undici", { recursive: true });
writeFileSync("node_modules/undici/package.json", JSON.stringify({ name: "undici", type: "module", main: "index.js" }));
writeFileSync("node_modules/undici/index.js", "export class EnvHttpProxyAgent {}\nexport function setGlobalDispatcher() {}\n");
try {
  const { logUrl } = await import(pathToFileURL(resolve(file)).href);
  const eq = (a, b) => { if (a !== b) fails.push(`BEHAVIOUR WRONG: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
  eq(logUrl("https://bob:pw@api.example.com/v1?x=1"), "https://***@api.example.com/v1?x=1");
  eq(logUrl("http://user@host:8080/p"), "http://***@host:8080/p");
  eq(logUrl("https://api.example.com/v1"), "https://api.example.com/v1");
  eq(logUrl("not a url"), "<invalid URL>");
} catch (e) { fails.push("BEHAVIOUR WRONG: " + e); }
if (fails.length) { console.error(fails.join("\n")); process.exit(1); }
console.log("ok");
