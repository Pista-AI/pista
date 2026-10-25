import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { HostConfig } from "@pista/protocol";

const require = createRequire(import.meta.url);

/** Extension entry points a Pi package declares in package.json → "pi.extensions" (what `pi install` loads). */
function packageExtensions(name: string): string[] {
  const manifest = require.resolve(`${name}/package.json`);
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { pi?: { extensions?: string[] } };
  return (pkg.pi?.extensions ?? []).map((entry) => resolve(dirname(manifest), entry));
}

/**
 * Pi packages that ship inside Pista (installed as host dependencies, so they
 * also work in the packaged desktop app without `pi install`).
 */
export function bundledExtensionPaths(config: HostConfig): string[] {
  const names = [
    config.memoryEnabled ? "pi-memory" : null, // cross-thread memory
    config.webSearchEnabled ? "pi-web-access" : null, // web_search / fetch_content
  ].filter((n): n is string => n !== null);
  return names.flatMap(packageExtensions);
}
