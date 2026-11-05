import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scripts } from "../src/page-scripts.ts";
import { guardDriver } from "../src/domains.ts";
import { confineToFolder, tempDownloadPath } from "../src/download.ts";
import type { BrowserDriver } from "../src/driver.ts";
import { registerBrowserTools } from "../src/tools.ts";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "dl-confine-")));
const outside = realpathSync(mkdtempSync(join(tmpdir(), "dl-outside-")));

test("confinement: relative paths, new subfolders ok", () => {
  assert.equal(confineToFolder(folder, "invoices/2026-01/a.pdf"), join(folder, "invoices/2026-01/a.pdf"));
  assert.equal(confineToFolder(folder, "./a.pdf"), join(folder, "a.pdf"));
});

test("confinement: parent traversal, absolute and empty paths are rejected", () => {
  for (const bad of ["../x.pdf", "a/../../x.pdf", "/etc/x.pdf", join(folder, "a.pdf"), "", "."]) assert.throws(() => confineToFolder(folder, bad), undefined, bad);
});

test("confinement: a symlinked parent that leads outside is rejected, also below a missing folder", () => {
  symlinkSync(outside, join(folder, "link"));
  assert.throws(() => confineToFolder(folder, "link/x.pdf"), /inside the project folder/);
  assert.throws(() => confineToFolder(folder, "link/new/x.pdf"), /inside the project folder/);
  mkdirSync(join(folder, "real"));
  symlinkSync(join(folder, "real"), join(folder, "alias"));
  assert.ok(confineToFolder(folder, "alias/x.pdf"));
});

test("confinement: an existing symlink as the file itself is rejected", () => {
  symlinkSync(join(outside, "target.pdf"), join(folder, "file-link.pdf"));
  assert.throws(() => confineToFolder(folder, "file-link.pdf"), /symbolic link/);
});

test("download guard: a redirect hop outside the allowlist deletes the file and refuses", async () => {
  const file = join(folder, "got.pdf");
  const inner = {
    navigate: async () => ({ url: "https://ok.test/", title: "", loading: false }),
    state: async () => ({ url: "https://ok.test/", title: "", loading: false }),
    download: async () => (writeFileSync(file, "x"), { bytes: 1, urlChain: ["https://ok.test/a", "https://evil.test/b.pdf"] }),
  } as unknown as BrowserDriver;
  const guarded = guardDriver(inner, { allowedDomains: ["ok.test"] });
  await assert.rejects(guarded.download!({ path: file, url: "https://ok.test/a" }), /policy/);
  assert.equal(existsSync(file), false);
});

test("href script: a ref resolves to its closest http(s) anchor, anything else to an empty string", () => {
  const link = { protocol: "https:", href: "https://x.test/invoice-1042.pdf" };
  const inLink = { closest: () => link };
  const plain = { closest: () => null };
  const mailto = { closest: () => ({ protocol: "mailto:", href: "mailto:a@b.c" }) };
  const run = (el: unknown) => {
    const win = { __pistaRefs: new Map([["e1", { deref: () => el }]]) };
    return new Function("window", "document", `return ${scripts.href("e1")}`)(win, { querySelector: () => null });
  };
  assert.equal(run(inLink), link.href);
  assert.equal(run(plain), "");
  assert.equal(run(mailto), "");
});

test("browser_download: needs exactly one of url or ref, and a driver that can download", async () => {
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  const api = { registerTool: (t: { name: string; execute: never }) => tools.set(t.name, t), on: () => undefined } as never;
  const saved: unknown[] = [];
  const driver = { download: async (o: unknown) => (saved.push(o), { bytes: 7 }), setActivity: () => undefined, state: async () => ({ url: "", title: "", loading: false }) } as unknown as BrowserDriver;
  registerBrowserTools(api, () => driver, { downloadRoot: () => folder, traceDir: "off" });
  const run = (args: object) => tools.get("browser_download")!.execute("1", args, undefined);
  await assert.rejects(run({ path: "a.pdf" }), /exactly one/);
  await assert.rejects(run({ url: "https://x.test/a", ref: "e1", path: "a.pdf" }), /exactly one/);
  await assert.rejects(run({ url: "https://x.test/a", path: "../a.pdf" }), /inside the project folder/);
  await run({ url: "https://x.test/a.pdf", path: "inv/a.pdf" });
  assert.deepEqual(saved, [{ path: join(folder, "inv/a.pdf"), url: "https://x.test/a.pdf" }]);
  const noDownload = { ...driver, download: undefined } as BrowserDriver;
  const tools2 = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  registerBrowserTools({ registerTool: (t: { name: string; execute: never }) => tools2.set(t.name, t), on: () => undefined } as never, () => noDownload, { downloadRoot: () => folder, traceDir: "off" });
  await assert.rejects(tools2.get("browser_download")!.execute("1", { url: "https://x.test/a", path: "a.pdf" }, undefined), /not supported/);
});

test("browser_download: a relative url resolves against the page url and the guard sees the absolute address", async () => {
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  const api = { registerTool: (t: { name: string; execute: never }) => tools.set(t.name, t), on: () => undefined } as never;
  const seen: string[] = [];
  const page = { url: "http://127.0.0.1:8765/invoices.html", title: "", loading: false };
  const inner = {
    state: async () => page,
    navigate: async () => page,
    download: async (o: { url?: string }) => (seen.push(o.url ?? ""), { bytes: 3, urlChain: [o.url ?? ""] }),
    setActivity: () => undefined,
  } as unknown as BrowserDriver;
  const run = async (rules: { allowedDomains: string[] }, url: string) => {
    tools.clear();
    registerBrowserTools(api, () => guardDriver(inner, rules), { downloadRoot: () => folder, traceDir: "off" });
    return tools.get("browser_download")!.execute("1", { url, path: "inv/r.pdf" }, undefined);
  };
  await run({ allowedDomains: ["127.0.0.1"] }, "/invoice-1042.pdf");
  assert.deepEqual(seen, ["http://127.0.0.1:8765/invoice-1042.pdf"]);
  // The raw "/x.pdf" has no host, so only the resolved address can be judged: it is on a host outside the allowlist.
  await assert.rejects(run({ allowedDomains: ["other.test"] }, "/invoice-1042.pdf"), /policy|blocked|allow/i);
  assert.equal(seen.length, 1);
});

test("browser_download: overwrite replaces, a broken file is replaced, a valid file needs overwrite", async () => {
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  const api = { registerTool: (t: { name: string; execute: never }) => tools.set(t.name, t), on: () => undefined } as never;
  const driver = {
    download: async (o: { path: string }) => (writeFileSync(o.path, "%PDF-1.7 new and good"), { bytes: 21 }),
    setActivity: () => undefined,
    state: async () => ({ url: "", title: "", loading: false }),
  } as unknown as BrowserDriver;
  registerBrowserTools(api, () => driver, { downloadRoot: () => folder, traceDir: "off" });
  const run = (args: object) => tools.get("browser_download")!.execute("1", { url: "https://x.test/a.pdf", ...args }, undefined) as Promise<{ details: { note?: string } }>;
  const file = join(folder, "ow.pdf");
  writeFileSync(file, "<html>403 Forbidden</html>");
  assert.match((await run({ path: "ow.pdf" })).details.note ?? "", /broken/);
  assert.equal(readFileSync(file, "utf8"), "%PDF-1.7 new and good");
  writeFileSync(file, "%PDF-1.7 valid old");
  await assert.rejects(run({ path: "ow.pdf" }), /overwrite: true/);
  assert.equal(readFileSync(file, "utf8"), "%PDF-1.7 valid old");
  assert.match((await run({ path: "ow.pdf", overwrite: true })).details.note ?? "", /replaced/);
  assert.equal(readFileSync(file, "utf8"), "%PDF-1.7 new and good");
  assert.deepEqual(readdirSync(folder).filter((n) => n.endsWith(".part")), []);
});

test("download temp path has no dot-prefixed segment and a directory target gives a clear error", async () => {
  const tmp = tempDownloadPath(join(folder, "inv/a.pdf"));
  assert.ok(!tmp.slice(folder.length).split("/").some((seg) => seg.startsWith(".")), tmp);
  mkdirSync(join(folder, "adir.pdf"));
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  const api = { registerTool: (t: { name: string; execute: never }) => tools.set(t.name, t), on: () => undefined } as never;
  const driver = { download: async () => ({ bytes: 1 }), setActivity: () => undefined, state: async () => ({ url: "", title: "", loading: false }) } as unknown as BrowserDriver;
  registerBrowserTools(api, () => driver, { downloadRoot: () => folder, traceDir: "off" });
  await assert.rejects(tools.get("browser_download")!.execute("1", { url: "https://x.test/a", path: "adir.pdf" }, undefined), /not a regular file/);
});

test("browser_download: a url that returns an HTML page is refused, flagged for the host, and leaves the target alone", async () => {
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  const api = { registerTool: (t: { name: string; execute: never }) => tools.set(t.name, t), on: () => undefined } as never;
  const traced: unknown[] = [];
  const driver = {
    download: async (o: { path: string }) => (writeFileSync(o.path, "<html><body>Invoice not found</body></html>"), { bytes: 43, contentType: "text/html; charset=utf-8" }),
    setActivity: () => undefined,
    state: async () => ({ url: "https://invoice.stripe.com/i/acct/live_x", title: "", loading: false }),
  } as unknown as BrowserDriver;
  registerBrowserTools(api, () => driver, { downloadRoot: () => folder, traceDir: "off", onTrace: (e) => traced.push(e) });
  const run = (args: object) => tools.get("browser_download")!.execute("1", { url: "https://invoice.stripe.com/i/acct/live_x", ...args }, undefined) as Promise<{ details: { rejected?: string; site?: string; note?: string } }>;
  const refused = (await run({ path: "html1.pdf" })).details;
  assert.equal(refused.rejected, "not-an-invoice");
  assert.equal(refused.site, "invoice.stripe.com");
  assert.match(refused.note ?? "", /returned a web page, not a file.*by ref/);
  assert.equal(existsSync(join(folder, "html1.pdf")), false);
  assert.deepEqual(traced, []);
  // An existing file, broken-looking or not, is neither overwritten nor removed.
  writeFileSync(join(folder, "html2.pdf"), "<html>403 Forbidden</html>");
  assert.equal((await run({ path: "html2.pdf" })).details.rejected, "not-an-invoice");
  writeFileSync(join(folder, "html3.pdf"), "%PDF-1.7 keep me");
  assert.equal((await run({ path: "html3.pdf", overwrite: true })).details.rejected, "not-an-invoice");
  assert.equal(readFileSync(join(folder, "html2.pdf"), "utf8"), "<html>403 Forbidden</html>");
  assert.equal(readFileSync(join(folder, "html3.pdf"), "utf8"), "%PDF-1.7 keep me");
  assert.deepEqual(readdirSync(folder).filter((n) => n.endsWith(".part")), []);
});

test("browser_download: an HTML page without a content type is caught by its first bytes; a PDF is kept", async () => {
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  const api = { registerTool: (t: { name: string; execute: never }) => tools.set(t.name, t), on: () => undefined } as never;
  let body = "  <!DOCTYPE html><html></html>";
  const driver = { download: async (o: { path: string }) => (writeFileSync(o.path, body), { bytes: body.length, contentType: "application/octet-stream" }), setActivity: () => undefined, state: async () => ({ url: "", title: "", loading: false }) } as unknown as BrowserDriver;
  registerBrowserTools(api, () => driver, { downloadRoot: () => folder, traceDir: "off" });
  const run = (path: string) => tools.get("browser_download")!.execute("1", { url: "https://x.test/a", path }, undefined) as Promise<{ details: { rejected?: string; bytes?: number } }>;
  assert.equal((await run("sniff1.pdf")).details.rejected, "not-an-invoice");
  body = "\ufeff<!-- x --><html></html>"; // a UTF-8 byte order mark in front
  assert.equal((await run("sniff3.pdf")).details.rejected, "not-an-invoice");
  body = "%PDF-1.7 fine";
  assert.equal((await run("sniff2.pdf")).details.bytes, 13);
});

test("browser_navigate by ref: the tab guard sees the link's address before anything is opened", async () => {
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<unknown> }>();
  const api = { registerTool: (t: { name: string; execute: never }) => tools.set(t.name, t), on: () => undefined } as never;
  const calls: string[] = [];
  const driver = {
    evaluate: async () => "https://guarded.test/billing?s=1",
    navigate: async (u: string) => (calls.push(u), { url: u, title: "", loading: false }),
    state: async () => ({ url: "", title: "", loading: false }),
    setActivity: () => undefined,
  } as unknown as BrowserDriver;
  registerBrowserTools(api, () => driver, { traceDir: "off", urlGuard: (u) => (u.includes("guarded.test") ? "Blocked: playbook first." : undefined) });
  await assert.rejects(tools.get("browser_navigate")!.execute("1", { ref: "e1" }, undefined), /Blocked: playbook first/);
  assert.deepEqual(calls, []);
});
