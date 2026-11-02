// Where the host gets the key for its encrypted credential store (auth.enc.json).
// Preferred: the desktop app posts the 32-byte key over the utilityProcess message channel right after fork
// (PISTA_AUTH_KEY_PORT=1, read from process.parentPort); it never appears in argv, the environment or logs.
// Headless: PISTA_AUTH_KEY (64 hex chars). A process's environment is visible to other processes of the same user,
// so the channel is preferred; the variable is removed from process.env once read so child processes (MCP servers,
// shell tools, `!command` values) do not inherit it.
// PISTA_AUTH_PLAIN=1 keeps Pi's plain auth.json. Key material is never logged or echoed in errors.
export type AuthKeySource = { kind: "key"; key: Buffer } | { kind: "plain" };

const HEX_KEY = /^[0-9a-fA-F]{64}$/;

export function formatAuthKeyHex(key: Buffer): string {
  return key.toString("hex");
}

/** The slice of Electron's process.parentPort the host uses (a utilityProcess child). Absent in plain Node. */
export interface ParentPortLike {
  once(event: "message", listener: (event: { data: unknown }) => void): unknown;
  removeListener?(event: "message", listener: (event: { data: unknown }) => void): unknown;
}

export function currentParentPort(): ParentPortLike | undefined {
  return "parentPort" in process ? (process as unknown as { parentPort?: ParentPortLike }).parentPort : undefined;
}

function readKeyMessage(port: ParentPortLike, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: { data: unknown }) => {
      clearTimeout(timer);
      const data = event.data as { type?: unknown; key?: unknown } | null;
      const key = data && typeof data === "object" ? data.key : undefined;
      if (data?.type !== "auth-key" || !(key instanceof Uint8Array) || key.byteLength !== 32) {
        if (key instanceof Uint8Array) key.fill(0);
        return reject(new Error("auth key message from the desktop app is malformed (expected 32 bytes)"));
      }
      const out = Buffer.from(key);
      key.fill(0);
      resolve(out);
    };
    const timer = setTimeout(() => {
      port.removeListener?.("message", onMessage);
      reject(new Error("timed out waiting for the auth key from the desktop app"));
    }, timeoutMs);
    port.once("message", onMessage);
  });
}

export async function resolveAuthKeySource(
  env: NodeJS.ProcessEnv,
  parentPort: ParentPortLike | undefined,
  options: { timeoutMs?: number } = {},
): Promise<AuthKeySource> {
  // Taken out of the environment on every path, so children never inherit it.
  // The hex string cannot be zeroed (JS strings are immutable); deleting the variable only stops children inheriting it.
  const envKey = env.PISTA_AUTH_KEY;
  delete env.PISTA_AUTH_KEY;
  if (env.PISTA_AUTH_KEY_PORT === "1") {
    if (!parentPort) throw new Error("PISTA_AUTH_KEY_PORT=1 needs the Pista desktop app (no parent message channel in this process)");
    return { kind: "key", key: await readKeyMessage(parentPort, options.timeoutMs ?? 10_000) };
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
