export interface LoginInput {
  label: string;
  loginUrl: string;
  username: string;
  password: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Returns a plain-language problem with the form values, or null when they look fine. The vault re-checks everything. */
export function validateLoginInput(i: LoginInput): string | null {
  if (!i.label.trim()) return "Give the site a name.";
  if (!i.loginUrl.trim()) return "Enter the sign-in page address.";
  let url: URL;
  try {
    url = new URL(i.loginUrl.trim());
  } catch {
    return "That address does not look right. It should start with https://";
  }
  if (url.username || url.password) return "Leave the username and password out of the address.";
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return "The address must start with https:// so your password is sent safely.";
  if (!i.username.trim()) return "Enter the username or email.";
  if (!i.password) return "Enter the password.";
  return null;
}

/** "https://app.slack.com" -> "app.slack.com"; falls back to the input when it is not a URL. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Result line for a CSV import. Counts only; no row content ever reaches the UI. */
export function formatImportResult(r: { imported: number; replaced: number; skipped: number; failed: number; canceled?: boolean }): string {
  if (r.canceled) return "";
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  let s = `Imported ${n(r.imported, "login", "logins")}, replaced ${r.replaced}, skipped ${r.skipped}.`;
  if (r.failed > 0) s += ` ${n(r.failed, "login", "logins")} could not be saved.`;
  return s;
}
