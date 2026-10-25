// MDM delivery of the managed policy: macOS managed preferences and the Windows HKLM policy key. Both carry the same
// JSON text as the policy file (`PolicyJSON`, or `PolicyJSONBase64`). Only device scope is read: a user could write
// their own HKCU key or user-scope preference, so those are never consulted. Commands run without a shell.
import { lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { win32 } from "node:path";

export type CommandRunner = (file: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
/** The parts of lstat the macOS reader checks; null when the path does not exist. */
export interface FileInfo {
  isFile: boolean;
  isSymlink: boolean;
  uid: number;
  mode: number;
}
export type LstatFn = (path: string) => FileInfo | null;

export type MdmResult = { kind: "none"; warnings?: string[] } | { kind: "ok"; text: string; source: string } | { kind: "error"; message: string; source: string };

export const MAC_PLIST = "/Library/Managed Preferences/app.pista.desktop.plist";
export const WIN_KEY = "HKLM\\SOFTWARE\\Policies\\Pista";
const MAC_SOURCE = `macOS managed preferences (${MAC_PLIST})`;

export const realRunner: CommandRunner = (file, args) => {
  const r = spawnSync(file, args, { encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
};

export const realLstat: LstatFn = (path) => {
  const s = lstatSync(path, { throwIfNoEntry: false });
  return s ? { isFile: s.isFile(), isSymlink: s.isSymbolicLink(), uid: s.uid, mode: s.mode } : null;
};

/** Picks the JSON text out of the two payload keys; undefined text means neither key is set. */
function pick(json: string | undefined, b64: string | undefined, source: string): MdmResult | { text: string } | undefined {
  if (json !== undefined && b64 !== undefined) return { kind: "error", message: "both PolicyJSON and PolicyJSONBase64 are set, set only one", source };
  if (json !== undefined) return { text: json };
  if (b64 !== undefined) {
    const clean = b64.replace(/\s+/g, "");
    if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return { kind: "error", message: "PolicyJSONBase64 is not valid base64", source };
    return { text: Buffer.from(clean, "base64").toString("utf8") };
  }
  return undefined;
}

export function readMacManaged(run: CommandRunner, lstat: LstatFn): MdmResult {
  let info: FileInfo | null;
  try {
    info = lstat(MAC_PLIST);
  } catch (error) {
    return { kind: "error", message: `cannot inspect ${MAC_PLIST} (${(error as Error).message})`, source: MAC_SOURCE };
  }
  if (!info) return { kind: "none" };
  if (!info.isFile || info.isSymlink || info.uid !== 0 || (info.mode & 0o022) !== 0) {
    return { kind: "error", message: "managed preferences file is not root-owned, or is a symlink, or is writable by group or others, refusing to use it", source: MAC_SOURCE };
  }
  const r = run("/usr/bin/plutil", ["-convert", "json", "-o", "-", MAC_PLIST]);
  if (r.status !== 0) return { kind: "error", message: `plutil failed (${r.stderr.trim() || `exit ${r.status}`})`, source: MAC_SOURCE };
  let dict: unknown;
  try {
    dict = JSON.parse(r.stdout);
  } catch (error) {
    return { kind: "error", message: `cannot parse plutil output (${(error as Error).message})`, source: MAC_SOURCE };
  }
  const get = (key: string) => (dict && typeof dict === "object" ? (dict as Record<string, unknown>)[key] : undefined);
  const [json, b64] = [get("PolicyJSON"), get("PolicyJSONBase64")];
  for (const [key, value] of [["PolicyJSON", json], ["PolicyJSONBase64", b64]] as const) {
    if (value !== undefined && typeof value !== "string") return { kind: "error", message: `${key} must be a string`, source: MAC_SOURCE };
  }
  const picked = pick(json as string | undefined, b64 as string | undefined, MAC_SOURCE);
  if (!picked) return { kind: "none", warnings: [`${MAC_PLIST} exists but has neither PolicyJSON nor PolicyJSONBase64, no MDM policy applied`] };
  return "kind" in picked ? picked : { kind: "ok", text: picked.text, source: MAC_SOURCE };
}

export function readWindowsPolicyKey(run: CommandRunner, env: NodeJS.ProcessEnv): MdmResult {
  const reg = win32.join(env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
  const r = run(reg, ["query", WIN_KEY]);
  if (r.status === null) return { kind: "error", message: `reg.exe could not run (${r.stderr.trim() || "no exit status"})`, source: WIN_KEY };
  if (r.status !== 0) {
    // No message text is matched (it is localized): ask whether the key exists instead.
    const parent = WIN_KEY.slice(0, WIN_KEY.lastIndexOf("\\"));
    const probe = run(reg, ["query", parent, "/k", "/f", "Pista", "/e"]);
    if (probe.status === null) return { kind: "error", message: `reg.exe could not run (${probe.stderr.trim() || "no exit status"})`, source: WIN_KEY };
    const full = `HKEY_LOCAL_MACHINE${WIN_KEY.slice("HKLM".length)}`.toLowerCase();
    if (probe.stdout.split(/\r?\n/).some((line) => line.trim().toLowerCase() === full)) return { kind: "error", message: `${WIN_KEY} exists but cannot be read (${r.stderr.trim() || `exit ${r.status}`})`, source: WIN_KEY };
    return { kind: "none" };
  }
  const values: Record<string, string> = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s+(PolicyJSON(?:Base64)?)\s+(REG_\w+)(?:\s+(.*))?$/i.exec(line);
    if (!m) continue;
    const name = m[1]!.toLowerCase() === "policyjson" ? "PolicyJSON" : "PolicyJSONBase64"; // registry value names are case-insensitive
    if (m[2] !== "REG_SZ" && m[2] !== "REG_EXPAND_SZ") return { kind: "error", message: `${name} is not a REG_SZ or REG_EXPAND_SZ value`, source: `${WIN_KEY} (${name})` };
    values[name] = m[3] ?? "";
  }
  const name = values.PolicyJSON !== undefined ? "PolicyJSON" : "PolicyJSONBase64";
  const picked = pick(values.PolicyJSON, values.PolicyJSONBase64, WIN_KEY);
  if (!picked) return { kind: "none", warnings: [`${WIN_KEY} exists but has neither PolicyJSON nor PolicyJSONBase64, no MDM policy applied`] };
  return "kind" in picked ? picked : { kind: "ok", text: picked.text, source: `${WIN_KEY} (${name})` };
}

/** MDM policy for this platform; Linux and others have none. */
export function readMdmPolicy(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, run: CommandRunner = realRunner, lstat: LstatFn = realLstat): MdmResult {
  if (platform === "darwin") return readMacManaged(run, lstat);
  if (platform === "win32") return readWindowsPolicyKey(run, env);
  return { kind: "none" };
}
