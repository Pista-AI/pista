import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";

/** What a file must match to be accepted. Every field is optional. */
export interface FileChecks {
  size?: number;
  /** Hex sha256 (what Hugging Face reports for LFS files). */
  sha256?: string;
  /** Git blob id: sha1 of "blob <size>\0" + content (what Hugging Face reports for small, non-LFS files). */
  gitBlobSha1?: string;
}

export interface DownloadOptions extends FileChecks {
  url: string;
  /** Final path. The bytes are written to `<dest>.partial` and only renamed here once they pass the checks. */
  dest: string;
  headers?: Record<string, string>;
  /** Called with the byte count so far, roughly every 4 MB and once at the end. */
  onProgress?: (bytes: number) => void;
  signal?: AbortSignal;
  /** Name used in the integrity error message; defaults to `dest`. */
  label?: string;
}

/**
 * Downloads `url` to `dest` via a `.partial` file, verifies it against the given checks, then renames it into place.
 * A file that fails verification is deleted and the call throws; a failed transfer leaves the partial file behind.
 */
export async function downloadFile(options: DownloadOptions): Promise<void> {
  const { url, dest, onProgress } = options;
  mkdirSync(dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  const res = await fetch(url, { headers: options.headers, signal: options.signal });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  let bytes = 0;
  let last = 0;
  const out = createWriteStream(partial);
  let streamError: Error | undefined;
  out.on("error", (error) => (streamError = error)); // reported below instead of becoming an uncaught exception
  const drained = () =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      out.once("error", onError);
      out.once("drain", () => {
        out.off("error", onError);
        resolve();
      });
    });
  try {
    for await (const chunk of Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>)) {
      if (streamError) throw streamError;
      bytes += chunk.length;
      if (!out.write(chunk)) await drained();
      if (bytes - last > 4_000_000) {
        last = bytes;
        onProgress?.(bytes);
      }
    }
    if (streamError) throw streamError;
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
  } catch (error) {
    out.destroy(); // transfer failed or was aborted; the partial file is left behind
    throw error;
  }
  onProgress?.(bytes);
  if (!(await verifyFile(partial, options))) {
    rmSync(partial, { force: true });
    throw new Error(`${options.label ?? dest} failed its integrity check; the download was discarded.`);
  }
  renameSync(partial, dest);
}

/** True when the file at `path` matches every given check (size, sha256 or git blob sha1). */
export async function verifyFile(path: string, checks: FileChecks): Promise<boolean> {
  const sha256 = checks.sha256 !== undefined;
  const blob = !sha256 && checks.gitBlobSha1 !== undefined;
  const hash = sha256 || blob ? createHash(sha256 ? "sha256" : "sha1") : undefined;
  if (blob) hash!.update(`blob ${checks.size ?? statSync(path).size}\0`);
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    hash?.update(chunk);
  }
  return (checks.size === undefined || size === checks.size) && (hash === undefined || hash.digest("hex") === (checks.sha256 ?? checks.gitBlobSha1));
}
