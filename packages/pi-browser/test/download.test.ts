import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { confineToFolder } from "../src/download.ts";
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
