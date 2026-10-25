// Downloads the updater files of a published GitHub release into a folder you can host on an internal HTTPS server.
// Usage: node scripts/mirror-release.mjs <tag> [outDir] [--repo owner/name]
// Needs the `gh` CLI, signed in. Run it once per release; stable and beta releases can share one outDir.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const repoAt = args.indexOf("--repo");
const defaultRepo = `${process.env.PISTA_UPDATE_OWNER || "Pista-AI"}/${process.env.PISTA_UPDATE_REPO || "pista"}`;
let repo = defaultRepo;
if (repoAt >= 0) {
  repo = args.splice(repoAt, 2)[1];
  if (!repo || repo.startsWith("-")) {
    console.error("--repo needs a value: --repo owner/name");
    process.exit(2);
  }
}
const [tag, outDir = "pista-feed"] = args;
if (tag?.startsWith("-")) {
  console.error(`Invalid tag "${tag}": a tag must not start with "-"`);
  process.exit(2);
}
if (!tag) {
  console.error("Usage: node scripts/mirror-release.mjs <tag> [outDir] [--repo owner/name]");
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const patterns = ["latest*.yml", "beta*.yml", "rc*.yml", "alpha*.yml", "*.zip", "*.zip.blockmap", "*.dmg", "*.dmg.blockmap"];
execFileSync("gh", ["release", "download", tag, "--repo", repo, "--dir", outDir, "--clobber", ...patterns.flatMap((p) => ["--pattern", p])], { stdio: "inherit" });

// Every file a yml names must be present next to it, or clients fail with a 404 mid-update.
const files = new Set(readdirSync(outDir));
const ymls = [...files].filter((f) => /^(latest|beta|rc|alpha)(-mac)?\.yml$/.test(f));
if (ymls.length === 0) throw new Error(`No updater yml in ${tag}: is the release published and built by release.yml?`);
let missing = 0;
for (const yml of ymls) {
  for (const m of readFileSync(path.join(outDir, yml), "utf8").matchAll(/^\s*(?:- )?(?:url|path):\s*(\S+)/gm)) {
    if (!files.has(m[1])) {
      console.error(`${yml} names ${m[1]} but it is not in ${outDir}`);
      missing++;
    }
  }
}
if (missing) process.exit(1);
console.log(`\nReady to host: ${path.resolve(outDir)}\nServe it as the directory behind updates.feedUrl, e.g. https://updates.example.com/pista/`);
