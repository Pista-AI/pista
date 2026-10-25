// Stages the pinned llama.cpp release at build/llama/<tag>/ so electron-builder can ship it in
// Contents/Resources/llama. macOS arm64 only; elsewhere (or with PISTA_BUNDLE_LLAMA=0) it does nothing
// and the host downloads llama.cpp on first use. The pin (tag, url, size, sha256) is read from the
// host's llama-build.json, the same file the host uses, so the two cannot drift.
// Network is needed once: the tarball is cached in apps/desktop/.cache/llama and verified every run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const desktop = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.resolve(desktop, "../host/src/llama-build.json"), "utf8"));
const platformKey = `${process.platform}-${process.arch}`;

export async function fetchLlama({ outRoot = path.join(desktop, "build", "llama"), cacheRoot = path.join(desktop, ".cache", "llama"), env = process.env } = {}) {
  if (env.PISTA_BUNDLE_LLAMA === "0") return console.log("llama.cpp: bundling disabled by PISTA_BUNDLE_LLAMA=0");
  const asset = manifest.assets[platformKey]?.find((a) => a.variant === "metal");
  if (platformKey !== "darwin-arm64" || !asset) return console.log(`llama.cpp: not bundled for ${platformKey}; the host downloads it on first use`);

  const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const verified = (file) => existsSync(file) && statSync(file).size === asset.size && sha256(file) === asset.sha256;

  mkdirSync(cacheRoot, { recursive: true });
  const archive = path.join(cacheRoot, `${manifest.tag}-${platformKey}.tar.gz`);
  if (verified(archive)) {
    console.log(`llama.cpp ${manifest.tag}: using cached ${path.relative(desktop, archive)}`);
  } else {
    console.log(`llama.cpp ${manifest.tag}: downloading ${asset.url}`);
    const res = await fetch(asset.url, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${asset.url}`);
    const partial = `${archive}.part`;
    writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
    if (!verified(partial)) {
      rmSync(partial, { force: true });
      throw new Error(`llama.cpp ${manifest.tag} download did not match the pinned size and sha256`);
    }
    renameSync(partial, archive);
  }

  // Extract, then flatten so llama-server and every dylib sit side by side (they find each other through @rpath).
  const scratch = path.join(cacheRoot, `extract-${manifest.tag}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", scratch]);
  const server = findFile(scratch, "llama-server");
  if (!server) throw new Error(`llama-server not found in the llama.cpp ${manifest.tag} archive`);

  const dest = path.join(outRoot, manifest.tag);
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  // Stage llama-server plus exactly the dylibs it reaches through @rpath references (found with otool, transitively).
  // Each is copied as a regular file under the name that is referenced (libfoo.0.dylib), so the version symlinks
  // (libfoo.dylib, libfoo.0.dylib -> libfoo.0.x.y.dylib) are not shipped. The release also holds ~30 CLI tools and
  // their libllama-*-impl dylibs; they are never referenced, so they are left out and need no signing.
  const from = path.dirname(server);
  const staged = new Set();
  const queue = ["llama-server"];
  while (queue.length > 0) {
    const name = queue.pop();
    if (staged.has(name)) continue;
    const source = path.join(from, name);
    if (!existsSync(source)) throw new Error(`${name} is referenced through @rpath but is missing from the llama.cpp ${manifest.tag} archive`);
    copyFileSync(source, path.join(dest, name)); // follows symlinks
    chmodSync(path.join(dest, name), 0o755);
    staged.add(name);
    queue.push(...rpathRefs(path.join(dest, name)));
  }
  if (existsSync(path.join(from, "LICENSE"))) copyFileSync(path.join(from, "LICENSE"), path.join(dest, "LICENSE"));
  else console.warn(`llama.cpp ${manifest.tag}: no LICENSE in the archive; shipping without it`);
  rmSync(scratch, { recursive: true, force: true });

  // Post-check on what will ship: every @rpath reference resolves inside the folder, and nothing is a symlink.
  for (const name of readdirSync(dest)) {
    if (lstatSync(path.join(dest, name)).isSymbolicLink()) throw new Error(`${name} in ${dest} is a symlink; stage regular files only`);
    if (name === "LICENSE") continue;
    for (const ref of rpathRefs(path.join(dest, name))) {
      if (!existsSync(path.join(dest, ref))) throw new Error(`${name} references @rpath/${ref}, which is not in ${dest}`);
    }
  }
  console.log(`llama.cpp ${manifest.tag}: staged ${path.relative(desktop, dest)} (${readdirSync(dest).length} files)`);
  return dest;
}

/** Names X of every `@rpath/X` load command in a Mach-O file. */
function rpathRefs(file) {
  const out = execFileSync("otool", ["-L", file], { encoding: "utf8" });
  return [...out.matchAll(/^\s+@rpath\/(\S+)/gm)].map((m) => m[1]);
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) return full;
  }
  return undefined;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await fetchLlama();
