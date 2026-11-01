import { execSync } from "node:child_process";

/** Runs a shell command and returns its trimmed stdout, or undefined on failure/empty output. */
export type CommandExec = (command: string) => string | undefined;

export interface ResolveOptions {
  exec?: CommandExec;
}

const defaultExec: CommandExec = (command) => {
  try {
    const out = execSync(command, { encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
};

// Process-lifetime cache keyed by the full "!command" string (failures are cached too, like Pi).
const commandCache = new Map<string, string | undefined>();

export function clearConfigValueCache(): void {
  commandCache.clear();
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Resolve a config value the way Pi does: "!cmd" runs a shell command (cached),
 * otherwise `$VAR` / `${VAR}` are interpolated from `env` then process.env.
 * `$$` is a literal "$" and `$!` a literal "!". Unset variables resolve the whole value to undefined.
 */
export function resolveConfigValue(
  value: string | undefined,
  env?: Record<string, string>,
  options: ResolveOptions = {},
): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("!")) {
    if (commandCache.has(value)) return commandCache.get(value);
    const result = (options.exec ?? defaultExec)(value.slice(1));
    commandCache.set(value, result);
    return result;
  }
  const lookup = (name: string) => env?.[name] || process.env[name] || undefined;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const d = value.indexOf("$", i);
    if (d < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, d);
    const next = value[d + 1];
    if (next === "$" || next === "!") {
      out += next;
      i = d + 2;
      continue;
    }
    let name: string | undefined;
    let end = d + 1;
    if (next === "{") {
      const close = value.indexOf("}", d + 2);
      if (close >= 0) {
        const inner = value.slice(d + 2, close);
        if (NAME_RE.test(inner)) name = inner;
        else {
          out += value.slice(d, close + 1);
          i = close + 1;
          continue;
        }
        end = close + 1;
      }
    } else {
      const m = value.slice(d + 1).match(NAME_PREFIX_RE);
      if (m) {
        name = m[0];
        end = d + 1 + m[0].length;
      }
    }
    if (name === undefined) {
      out += "$";
      i = d + 1;
      continue;
    }
    const v = lookup(name);
    if (v === undefined) return undefined;
    out += v;
    i = end;
  }
  return out;
}
