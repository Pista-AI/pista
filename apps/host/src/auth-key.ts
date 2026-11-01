// Where the host gets the key for its encrypted credential store (auth.enc.json).
// Preferred: the desktop app writes the key as one hex line to the host's stdin (PISTA_AUTH_KEY_STDIN=1); it never
// appears in argv or the environment. Headless: PISTA_AUTH_KEY (64 hex chars). A process's environment is visible to
// other processes of the same user, so stdin is preferred; the variable is removed from process.env once read so
// child processes (MCP servers, shell tools, `!command` values) do not inherit it.
// PISTA_AUTH_PLAIN=1 keeps Pi's plain auth.json. Key material is never logged or echoed in errors.
export type AuthKeySource = { kind: "key"; key: Buffer } | { kind: "plain" };

const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const MAX_LINE = 1024;

export function formatAuthKeyHex(key: Buffer): string {
  return key.toString("hex");
}

function readKeyLine(stdin: NodeJS.ReadableStream, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const done = (fn: () => void) => {
      clearTimeout(timer);
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.removeListener("error", onError);
      stdin.pause();
      (stdin as { unref?: () => void }).unref?.();
      fn();
    };
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) return done(() => resolve(buf.slice(0, nl).replace(/\r$/, "")));
      if (buf.length > MAX_LINE) done(() => reject(new Error("auth key on stdin is malformed (line too long)")));
    };
    const onEnd = () => done(() => reject(new Error("auth key on stdin is malformed (stream ended before a newline)")));
    const onError = () => done(() => reject(new Error("auth key could not be read from stdin")));
    const timer = setTimeout(() => done(() => reject(new Error("timed out waiting for the auth key on stdin"))), timeoutMs);
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);
  });
}

export async function resolveAuthKeySource(
  env: NodeJS.ProcessEnv,
  stdin: NodeJS.ReadableStream,
  options: { timeoutMs?: number } = {},
): Promise<AuthKeySource> {
  // Taken out of the environment on every path, so children never inherit it.
  const envKey = env.PISTA_AUTH_KEY;
  delete env.PISTA_AUTH_KEY;
  if (env.PISTA_AUTH_KEY_STDIN === "1") {
    const line = await readKeyLine(stdin, options.timeoutMs ?? 5000);
    if (!HEX_KEY.test(line)) throw new Error("auth key on stdin is malformed (expected 64 hex characters)");
    return { kind: "key", key: Buffer.from(line, "hex") };
  }
  if (envKey !== undefined) {
    const value = envKey;
    if (!HEX_KEY.test(value)) throw new Error("PISTA_AUTH_KEY is malformed (expected 64 hex characters)");
    return { kind: "key", key: Buffer.from(value, "hex") };
  }
  if (env.PISTA_AUTH_PLAIN === "1") return { kind: "plain" };
  throw new Error(
    "No auth key: start Pista from the desktop app, or set PISTA_AUTH_KEY (64 hex chars) for headless use, or PISTA_AUTH_PLAIN=1 to keep Pi's plain auth.json.",
  );
}
