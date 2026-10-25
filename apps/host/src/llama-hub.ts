import { fetchJson, HttpError } from "@pista/local-runtime";
import type { LlamaHubModel } from "@pista/protocol";

// Outbound HTTPS from the host to huggingface.co, only when the user searches or inspects a repo
// (model downloads are opt-in). The token, if HF_TOKEN is set, goes to this host only.
const HF_API = "https://huggingface.co/api/models";
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const TIMEOUT_MS = 10_000;

interface HfModel {
  id?: string;
  modelId?: string;
  downloads?: number;
  likes?: number;
  siblings?: { rfilename?: string; size?: number }[];
}

const QUANT =
  /(?:^|[-._])((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4|TQ\d(?:_\d)?))((?:-[A-Za-z]+)*)(?:-\d{5}-of-\d{5})?\.gguf$/i;

/** Projector and multi-token-prediction companions are not loadable weights on their own. */
const COMPANION = /mmproj|(?:^|[-_.])mtp(?:[-_.]|$)/i;

/**
 * `Qwen3-1.7B-UD-Q4_K_XL-00001-of-00002.gguf` -> `UD-Q4_K_XL`; `gemma-4-E4B_q4_0-it.gguf` -> `Q4_0-it`.
 * Words after the quant stay in the tag because Hugging Face resolves `repo:TAG` against them
 * (`Q4_0-it` resolves for that repo, `Q4_0` does not). Undefined for companions and non-GGUF files.
 */
export function quantOf(filename: string): string | undefined {
  const base = filename.split("/").pop() ?? filename;
  if (COMPANION.test(base)) return undefined;
  const match = QUANT.exec(base);
  if (!match?.[1]) return undefined;
  const tag = match[1].toUpperCase() + (match[2] ?? "");
  // A tag the download spec validator (32 chars) would reject is listed as unresolved instead of failing later.
  return tag.length <= 32 ? tag : undefined;
}

/** Maps an HF model payload; split files of one quantization are summed. GGUF files with no derivable quant are listed as unresolved. Pure. */
export function toHubModel(model: HfModel): LlamaHubModel {
  const found = new Map<string, { sizeBytes: number; unresolved: boolean }>();
  for (const file of model.siblings ?? []) {
    const name = file.rfilename;
    if (!name) continue;
    const base = name.split("/").pop() ?? name;
    if (!/\.gguf$/i.test(base) || COMPANION.test(base)) continue;
    const quant = quantOf(name);
    const key = quant ?? base.replace(/\.gguf$/i, "");
    const entry = found.get(key) ?? { sizeBytes: 0, unresolved: !quant };
    entry.sizeBytes += file.size ?? 0;
    found.set(key, entry);
  }
  return {
    id: model.id ?? model.modelId ?? "",
    ...(model.downloads !== undefined ? { downloads: model.downloads } : {}),
    ...(model.likes !== undefined ? { likes: model.likes } : {}),
    files: [...found]
      .map(([quant, e]) => ({ quant, sizeBytes: e.sizeBytes, ...(e.unresolved ? { unresolved: true } : {}) }))
      .sort((a, b) => Number(a.unresolved ?? false) - Number(b.unresolved ?? false) || a.sizeBytes - b.sizeBytes),
  };
}

async function hfGet<T>(url: string, http: typeof fetch, env: NodeJS.ProcessEnv): Promise<T> {
  const token = env.HF_TOKEN?.trim();
  try {
    return await fetchJson<T>(url, {
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      timeoutMs: TIMEOUT_MS,
      fetch: http,
    });
  } catch (error) {
    if (error instanceof HttpError) throw new Error(`Hugging Face answered HTTP ${error.status}.`);
    throw error;
  }
}

export async function searchHub(query: string, http: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<LlamaHubModel[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const rows = await hfGet<HfModel[]>(`${HF_API}?search=${encodeURIComponent(q)}&filter=gguf&limit=20&sort=downloads`, http, env);
  return rows.map(toHubModel).filter((m) => m.id);
}

export async function inspectHub(id: string, http: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<LlamaHubModel> {
  if (!REPO.test(id)) throw new Error(`"${id}" is not a Hugging Face repo id (<org>/<name>).`);
  return toHubModel(await hfGet<HfModel>(`${HF_API}/${id}?blobs=true`, http, env));
}
