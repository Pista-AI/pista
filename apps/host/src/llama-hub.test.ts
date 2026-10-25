import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectHub, quantOf, searchHub, toHubModel } from "./llama-hub.ts";

describe("Hugging Face helpers", () => {
  it("extracts quant names and skips projector files", () => {
    assert.equal(quantOf("Qwen3-1.7B-Q4_K_M.gguf"), "Q4_K_M");
    assert.equal(quantOf("Qwen3-1.7B-UD-Q4_K_XL.gguf"), "UD-Q4_K_XL");
    assert.equal(quantOf("Q8_0/model-Q8_0-00001-of-00003.gguf"), "Q8_0");
    assert.equal(quantOf("model-IQ4_XS.gguf"), "IQ4_XS");
    assert.equal(quantOf("model.BF16.gguf"), "BF16");
    assert.equal(quantOf("mmproj-F16.gguf"), undefined);
    assert.equal(quantOf("README.md"), undefined);
  });

  it("accepts underscore separators and trailing words after the quant", () => {
    assert.equal(quantOf("gemma-4-E4B_q4_0-it.gguf"), "Q4_0-it");
    assert.equal(quantOf("gemma-4-12b-it-qat-q4_0.gguf"), "Q4_0");
    assert.equal(quantOf("gemma-4-E4B-it-Q4_K_M.gguf"), "Q4_K_M");
    assert.equal(quantOf("Qwen3-1.7B-UD-IQ1_S.gguf"), "UD-IQ1_S");
    assert.equal(quantOf("Qwen3-1.7B-Q4_K_M-00001-of-00002.gguf"), "Q4_K_M");
    assert.equal(quantOf("model-MXFP4.gguf"), "MXFP4");
    assert.equal(quantOf("gemma-4-E4B-it-mmproj.gguf"), undefined);
    assert.equal(quantOf("mmproj-gemma-4-E4B_q4_0-it.gguf"), undefined);
    assert.equal(quantOf("model-mtp-Q4_K_M.gguf"), undefined);
  });

  it("lists the Google gemma repo and keeps unresolvable GGUF files visible", () => {
    assert.deepEqual(
      toHubModel({
        id: "google/gemma-4-E4B-it-qat-q4_0-gguf",
        siblings: [
          { rfilename: "other.txt", size: 2 },
          { rfilename: "README.md", size: 3 },
          { rfilename: "gemma-4-E4B-it-mmproj.gguf", size: 9 },
          { rfilename: "gemma-4-E4B_q4_0-it.gguf", size: 5154941280 },
        ],
      }).files,
      [{ quant: "Q4_0-it", sizeBytes: 5154941280 }],
    );
    const m = toHubModel({
      id: "o/r",
      siblings: [
        { rfilename: "weird-name.gguf", size: 4 },
        { rfilename: "r-Q4_K_M.gguf", size: 8 },
        { rfilename: "mtp-draft.gguf", size: 1 },
      ],
    });
    assert.deepEqual(m.files, [{ quant: "Q4_K_M", sizeBytes: 8 }, { quant: "weird-name", sizeBytes: 4, unresolved: true }]);
  });

  it("sums split files per quant and sorts by size", () => {
    const m = toHubModel({
      id: "o/r",
      downloads: 5,
      likes: 1,
      siblings: [
        { rfilename: "r-Q8_0-00001-of-00002.gguf", size: 600 },
        { rfilename: "r-Q8_0-00002-of-00002.gguf", size: 500 },
        { rfilename: "r-Q4_K_M.gguf", size: 300 },
        { rfilename: "mmproj-F16.gguf", size: 9 },
        { rfilename: "README.md", size: 1 },
      ],
    });
    assert.deepEqual(m, { id: "o/r", downloads: 5, likes: 1, files: [{ quant: "Q4_K_M", sizeBytes: 300 }, { quant: "Q8_0", sizeBytes: 1100 }] });
  });

  function fakeFetch(body: unknown) {
    const seen: { url: string; auth: string | null }[] = [];
    const http = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    return { http, seen };
  }

  it("searches GGUF repos by downloads, with a bearer token only when HF_TOKEN is set", async () => {
    const a = fakeFetch([{ id: "o/r", downloads: 3, likes: 2 }, { modelId: "p/q" }]);
    const results = await searchHub("qwen 3", a.http, {});
    assert.equal(a.seen[0]?.url, "https://huggingface.co/api/models?search=qwen%203&filter=gguf&limit=20&sort=downloads");
    assert.equal(a.seen[0]?.auth, null);
    assert.deepEqual(results, [{ id: "o/r", downloads: 3, likes: 2, files: [] }, { id: "p/q", files: [] }]);
    const b = fakeFetch([]);
    await searchHub("x", b.http, { HF_TOKEN: "hf_secret" });
    assert.equal(b.seen[0]?.auth, "Bearer hf_secret");
    assert.deepEqual(await searchHub("  ", a.http, {}), []);
  });

  it("caps the query at 100 characters", async () => {
    const f = fakeFetch([]);
    await searchHub("a".repeat(500), f.http, {});
    assert.equal(new URL(f.seen[0]!.url).searchParams.get("search"), "a".repeat(100));
  });

  it("inspects one repo with blobs and refuses ids that are not org/name", async () => {
    const f = fakeFetch({ id: "o/r", siblings: [{ rfilename: "r-Q4_K_M.gguf", size: 7 }] });
    assert.deepEqual(await inspectHub("o/r", f.http, {}), { id: "o/r", files: [{ quant: "Q4_K_M", sizeBytes: 7 }] });
    assert.equal(f.seen[0]?.url, "https://huggingface.co/api/models/o/r?blobs=true");
    await assert.rejects(inspectHub("../etc/passwd", f.http, {}), /not a Hugging Face repo id/);
    await assert.rejects(inspectHub("o/r?x=1", f.http, {}), /not a Hugging Face repo id/);
    assert.equal(f.seen.length, 1);
  });
});
