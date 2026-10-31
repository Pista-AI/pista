import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ManagedPolicy } from "@pista/protocol";
import { type AuditSink, noopAudit } from "../audit.ts";
import { emitHarnessDecision } from "../audit-events.ts";
import { harnessDecision } from "./gate.ts";
import { registerHarness } from "./registry.ts";
import type { Harness } from "./types.ts";

// Loads harnesses shipped by Pi packages: package.json declares `"pista": { "harness": { "id": "...", "entry": "./dist/harness.js" } }`,
// an ES module whose default export is a Harness (or a function returning one). Loading runs package code in the
// host process, so the policy gate (allow list + managed package) decides whether the result may run.

export interface PackageSourceOpts {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  managedPackages: string[];
}

export interface LoadOpts extends PackageSourceOpts {
  policy: ManagedPolicy | undefined;
  selectedByPolicy: boolean;
  /** Where policy denials are reported; defaults to none. */
  audit?: AuditSink;
}

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const escapes = (rel: string): boolean => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

type Pm = Pick<DefaultPackageManager, "getInstalledPath">;

/** Pi's identity for a source: `npm:name@ver` is `npm:name`; anything else is the raw string. */
const identity = (source: string): string => (source.startsWith("npm:") ? source.replace(/^(npm:(?:@[^/@]+\/)?[^/@]+)@.*$/, "$1") : source);

/** Pi's configured global packages plus the managed list, each marked managed or not. */
export function harnessPackageSources(opts: PackageSourceOpts): { source: string; managed: boolean }[] {
  const settings = SettingsManager.create(opts.cwd, opts.agentDir, { projectTrusted: opts.projectTrusted });
  const configured = (settings.getGlobalSettings().packages ?? []).map((p) => (typeof p === "string" ? p : p.source));
  const managedIds = new Set(opts.managedPackages.map(identity));
  const seen = new Set<string>();
  const out: { source: string; managed: boolean }[] = [];
  for (const source of [...opts.managedPackages, ...configured]) {
    if (seen.has(identity(source))) continue;
    seen.add(identity(source));
    out.push({ source, managed: managedIds.has(identity(source)) });
  }
  return out;
}

/** The harness a package declares (`pista.harness: { id, entry }`), when installed in user scope and the entry stays inside the package. */
export function findHarnessEntry(pm: Pm, source: string): { dir: string; entry: string; id: string; packageName: string } | undefined {
  const dir = pm.getInstalledPath(source, "user");
  if (!dir) return undefined;
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return undefined;
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown; pista?: { harness?: unknown } };
  const declared = pkg.pista?.harness;
  if (declared === undefined) return undefined;
  if (!declared || typeof declared !== "object") throw new Error('pista.harness must be an object { "id", "entry" }');
  const { id, entry: file } = declared as { id?: unknown; entry?: unknown };
  if (typeof id !== "string" || !ID.test(id)) throw new Error("pista.harness.id must match /^[a-z][a-z0-9-]{0,63}$/");
  if (typeof file !== "string" || !file || isAbsolute(file)) return undefined;
  const entry = resolve(dir, file);
  if (escapes(relative(dir, entry)) || !existsSync(entry)) return undefined;
  // A symlink must not lead out of the package either.
  if (escapes(relative(realpathSync(dir), realpathSync(entry)))) return undefined;
  return { dir, entry, id, packageName: typeof pkg.name === "string" ? pkg.name : source };
}

const isFn = (v: unknown): boolean => v === undefined || typeof v === "function";

function asHarness(value: unknown): Harness {
  const h = (typeof value === "function" ? (value as () => unknown)() : value) as Partial<Harness> | undefined;
  if (!h || typeof h !== "object" || typeof h.id !== "string" || !ID.test(h.id)) throw new Error("default export is not a harness (id missing or invalid)");
  if (![h.extension, h.prompt, h.tools, h.validateConfig].every(isFn)) throw new Error("harness hooks must be functions");
  if (h.entries !== undefined && !(Array.isArray(h.entries) && h.entries.every((e) => typeof e === "string"))) throw new Error("harness entries must be strings");
  const ev = (h as { eval?: unknown }).eval as { metrics?: unknown; column?: { header?: unknown; cell?: unknown } } | undefined;
  if (ev !== undefined) {
    const col = ev && typeof ev === "object" ? ev.column : null;
    const colOk = col === undefined || (!!col && typeof col === "object" && typeof col.header === "string" && typeof col.cell === "function");
    if (!ev || typeof ev !== "object" || typeof ev.metrics !== "function" || !colOk) throw new Error("harness eval must be { metrics(), column?: { header, cell() } }");
  }
  return h as Harness;
}

const warnedSources = new Set<string>();
const missed = new Set<string>();

/** Forget negative results and warnings; call when config changes so a newly installed package is retried. */
export function resetHarnessPackageCache(): void {
  warnedSources.clear();
  missed.clear();
}

function warnOnce(source: string, reason: string): void {
  if (warnedSources.has(source)) return;
  warnedSources.add(source);
  console.warn(`[pista-host] harness package ${source}: ${reason}`);
}

/** Finds, imports and registers the harness `id` from an installed package. Any failure warns once and returns undefined. */
export async function loadPackageHarness(id: string, opts: LoadOpts): Promise<Harness | undefined> {
  if (missed.has(id)) return undefined;
  let sources: { source: string; managed: boolean }[];
  let pm: DefaultPackageManager;
  try {
    sources = harnessPackageSources(opts);
    pm = new DefaultPackageManager({ cwd: opts.cwd, agentDir: opts.agentDir, settingsManager: SettingsManager.create(opts.cwd, opts.agentDir, { projectTrusted: opts.projectTrusted }) });
  } catch (error) {
    warnOnce("(settings)", (error as Error).message);
    return undefined;
  }
  for (const { source, managed } of sources) {
    try {
      const found = findHarnessEntry(pm, source);
      if (!found || found.id !== id) continue;
      // The gate runs before any package code does.
      const decision = harnessDecision({ id, policy: opts.policy, selectedByPolicy: opts.selectedByPolicy, source: { package: source, managedPackage: managed } });
      if (!decision.allow) {
        warnOnce(source, `denied by policy (${decision.rule}); not loaded`);
        emitHarnessDecision(opts.audit ?? noopAudit, id, decision.rule, source);
        continue;
      }
      const mod = (await import(pathToFileURL(found.entry).href)) as { default?: unknown };
      const harness = asHarness(mod.default);
      if (harness.id !== id) continue;
      if (!registerHarness(harness, { package: source, managedPackage: managed })) continue;
      return harness;
    } catch (error) {
      warnOnce(source, (error as Error).message);
    }
  }
  missed.add(id);
  return undefined;
}
