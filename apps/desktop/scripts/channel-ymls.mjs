// With the github publish provider electron-builder writes only latest*.yml, even for a prerelease version such as
// 0.3.0-rc.1 (it leaves the prerelease handling to GitHub). The updater, however, asks for <channel>*.yml when a
// channel is selected (policy updates.channel "beta", or an installed prerelease following its own channel), and the
// company mirror serves flat directories. So for a prerelease version every latest*.yml is also written as
// <channel>*.yml, where the channel is the first prerelease identifier (beta, rc, alpha). Stable versions are untouched.
import { copyFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** "0.3.0-rc.1" -> "rc"; "0.3.0" -> null. */
export function prereleaseChannel(version) {
  const m = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version);
  return m ? m[1] : null;
}

/** Copies latest.yml, latest-mac.yml, latest-linux.yml in `dir` to the channel names. Returns the files written. */
export function writeChannelYmls(dir, version) {
  const channel = prereleaseChannel(version);
  if (!channel) return [];
  const written = [];
  for (const name of readdirSync(dir)) {
    const m = /^latest((?:-mac|-linux)?\.yml)$/.exec(name);
    if (!m) continue;
    const target = `${channel}${m[1]}`;
    copyFileSync(path.join(dir, name), path.join(dir, target));
    written.push(target);
  }
  return written;
}
