import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { CdpDriver } from "../src/drivers/cdp.ts";
import { formatSnapshot, scripts, type PageSnapshot } from "../src/page-scripts.ts";

// Page scripts need real layout, so this drives a headless Chromium over CDP (PISTA_CHROME to point at one) and skips without it.
const CHROME = [
  process.env.PISTA_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && existsSync(p));

let chrome: ChildProcess | undefined;
let dir = "";
let snap: PageSnapshot;
let driver: CdpDriver;

before(async () => {
  if (!CHROME) return;
  dir = mkdtempSync(join(tmpdir(), "pista-name-fallback-"));
  // CI runners (ubuntu) run as a user that cannot use Chromium's sandbox.
  const ci = process.env.CI ? ["--no-sandbox", "--disable-gpu"] : ["--disable-gpu"];
  chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", ...ci, "about:blank"], { stdio: "ignore" });
  let port = "";
  // Wait up to 30 s: parallel test files start several Chromes at once and a loaded CI runner needs more than 10 s.
  for (let i = 0; i < 300 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      port = readFileSync(join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]!;
    } catch {
      /* not started yet */
    }
  }
  if (!port) throw new Error(`Chrome at ${CHROME} did not open a DevTools port (no DevToolsActivePort in ${dir} after 30 s; exit code ${chrome.exitCode})`);
  driver = new CdpDriver(`http://127.0.0.1:${port}`);
  await driver.navigate(pathToFileURL(resolve(import.meta.dirname, "fixture/unnamed.html")).href);
  snap = (await driver.evaluate(scripts.snapshot(50))) as PageSnapshot;
});

after(async () => {
  if (chrome && chrome.exitCode === null) {
    const closed = new Promise((r) => chrome!.once("close", r));
    chrome.kill();
    await closed;
  }
  // Best effort: Chrome helper processes can still write to the profile after the main
  // process exits (seen on CI as ENOTEMPTY); a leftover temp dir must not fail the run.
  try {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
});

const skip = CHROME ? false : "no Chromium found (set PISTA_CHROME)";
const sig = () => snap.elements.map((e) => `${e.role}|${e.nameSource ? "~" : ""}${e.name}`);

test("unnamed controls get derived names from title, placeholder, image alt, svg title, href, nearby text and ids", { skip }, () => {
  assert.deepEqual(sig(), [
    "button|~Sortera", // title
    "textbox|~Search products", // placeholder
    "button|~Cart icon", // img alt
    "button|~Close dialog", // svg title
    "link|~winter jackets", // href path
    "link|", // /p/12345 looks like an id: stays unnamed
    "button|~Quantity", // preceding text
    "button|~Filters", // ancestor legend
    "button|~cart toggle button", // data-testid, humanised
    "button|~menu open", // id, humanised
    "button|Save", // a real name
    "button|~after save", // the preceding sibling is another control, not a label, so it falls through to the id
    "button|", // numeric id is skipped
    "textbox|~email", // a field keeps its name attribute even though text precedes it
    "button|", // a counter/price is not a label
    "link|", // vbscript: href never names a link
    "link|", // javascript: (mixed case, leading space) likewise
    "link|", // data: likewise
    "link|Guide",
    "link|Mail",
    "link|Call",
    "link|Blob",
    "link|Blank",
    "link|Rel",
    "link|Up",
    "link|File",
  ]);
});

test("only http(s) and file links get a destination; script-bearing schemes do not", { skip }, () => {
  const links = snap.lines.filter((l) => l.includes("link"));
  const text = links.join("\n");
  assert.doesNotMatch(text, /vbs-seg|js-seg|data-seg|vbscript|javascript|data:/i);
  assert.match(text, /→ example\.com\/docs\/guide/);
  assert.match(text, /"Mail".*→ mailto:a@b\.c/);
  assert.match(text, /"Call".*→ tel:\+4670000/);
  assert.match(text, /"Rel".*→ \/x/);
  assert.match(text, /"Up".*→ \//);
  assert.match(text, /"File".*→ \/tmp\/file-seg\/ok/);
  for (const label of ["Blob", "Blank"]) assert.doesNotMatch(links.find((l) => l.includes(`"${label}"`)) ?? "", /→/);
});

test("derived names are flagged nameSource=fallback and real names are not", { skip }, () => {
  assert.equal(snap.elements[0]!.nameSource, "fallback");
  assert.equal(snap.elements[10]!.nameSource, undefined);
  assert.equal(snap.elements[5]!.nameSource, undefined);
});

test("snapshot lines mark derived names with a tilde and explain it once", { skip }, () => {
  assert.match(snap.lines.join("\n"), /\[e1\] button ~"Sortera"/);
  assert.match(snap.lines.join("\n"), /\[e11\] button "Save"/);
  const text = formatSnapshot(snap);
  assert.match(text, /A name written ~"like this" is derived/);
  assert.equal(text.match(/is derived/g)?.length, 1);
});

test("the ref still matches under its derived name, and not under another", { skip }, async () => {
  // elementStillMatches compares role+name, so a fallback name works like any other.
  assert.equal(await driver.evaluate(scripts.elementStillMatches("e1", "button", "Sortera")), true);
  assert.equal(await driver.evaluate(scripts.elementStillMatches("e1", "button", "Sort")), false);
});
