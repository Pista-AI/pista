import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Makes the profile keep logins across restarts: "continue where you left off" (restore_on_startup = 1) lets Chrome
 * keep session-only cookies, and a previous kill is recorded as a clean exit so Chrome shows no restore bubble.
 * Other preferences are kept as they are. A Preferences file that is not valid JSON is left alone.
 * Returns whether the file was written.
 */
export function ensureProfilePrefs(profileDir: string): boolean {
  const file = join(profileDir, "Default", "Preferences");
  let prefs: any = {};
  try {
    prefs = JSON.parse(readFileSync(file, "utf8"));
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return false;
  } catch (e: any) {
    if (e?.code !== "ENOENT") return false; // unreadable or malformed: do not overwrite what we cannot parse
  }
  const session = typeof prefs.session === "object" && prefs.session ? prefs.session : (prefs.session = {});
  const profile = typeof prefs.profile === "object" && prefs.profile ? prefs.profile : (prefs.profile = {});
  let changed = session.restore_on_startup !== 1;
  session.restore_on_startup = 1;
  if (profile.exit_type === "Crashed") (profile.exit_type = "Normal", (changed = true));
  if (profile.exited_cleanly === false) (profile.exited_cleanly = true, (changed = true));
  if (!changed) return false;
  const tmp = `${file}.pista-tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify(prefs), { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch {
    try { rmSync(tmp, { force: true }); } catch {}
    return false;
  }
}
