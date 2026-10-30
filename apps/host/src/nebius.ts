import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Nebius Token Factory: OpenAI-compatible inference for open models.
 * Enabled by setting NEBIUS_API_KEY in the host environment (or by storing a key via login).
 * Model ids, context windows and prices come from the public catalog
 * (https://tokenfactory.nebius.com/api/public/models_info); prices are USD per 1M tokens.
 * The catalog publishes no max output length; maxTokens is a flat cap that bounds the cost of a single stuck call while leaving room for large file writes and reasoning.
 */
export const NEBIUS_PROVIDER_ID = "nebius";
export const NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
export const NEBIUS_API_KEY_ENV = "NEBIUS_API_KEY";

const MAX_OUTPUT = 65536;

interface NebiusModel {
  id: string;
  name: string;
  reasoning: boolean;
  image?: boolean;
  contextWindow: number;
  /** USD per 1M tokens. */
  input: number;
  output: number;
}

const NEBIUS_MODELS: NebiusModel[] = [
  { id: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash 0731", reasoning: true, contextWindow: 1_024_000, input: 0.14, output: 0.28 },
  { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro", reasoning: true, contextWindow: 1_048_576, input: 1.75, output: 3.5 },
  { id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code", reasoning: true, contextWindow: 262_144, input: 0.95, output: 4 },
  { id: "zai-org/GLM-5.3", name: "GLM 5.3", reasoning: true, contextWindow: 1_024_000, input: 1.4, output: 4.4 },
  { id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3", reasoning: true, image: true, contextWindow: 1_048_576, input: 0.3, output: 1.2 },
  { id: "Qwen/Qwen3.5-397B-A17B", name: "Qwen3.5 397B A17B", reasoning: true, contextWindow: 262_144, input: 0.6, output: 3.6 },
  { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen3 235B A22B Instruct 2507", reasoning: false, contextWindow: 262_144, input: 0.2, output: 0.6 },
  { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super 120B A12B", reasoning: true, contextWindow: 262_144, input: 0.3, output: 0.9 },
  { id: "openai/gpt-oss-120b", name: "gpt-oss 120B", reasoning: true, contextWindow: 131_072, input: 0.15, output: 0.6 },
];

/** Registers Nebius as a Pi provider; it counts as configured only when NEBIUS_API_KEY (or a stored key) exists. */
/** `contextWindowCap` (evals) lowers every model's window to at most that many tokens. */
export function registerNebiusProvider(runtime: ModelRuntime, contextWindowCap?: number): void {
  runtime.registerProvider(NEBIUS_PROVIDER_ID, {
    name: "Nebius",
    baseUrl: NEBIUS_BASE_URL,
    api: "openai-completions",
    apiKey: `$${NEBIUS_API_KEY_ENV}`,
    models: NEBIUS_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      api: "openai-completions" as const,
      reasoning: m.reasoning,
      input: (m.image ? ["text", "image"] : ["text"]) as ("text" | "image")[],
      cost: { input: m.input, output: m.output, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindowCap ? Math.min(m.contextWindow, contextWindowCap) : m.contextWindow,
      maxTokens: MAX_OUTPUT,
      // Nebius accepts only system/user/assistant/tool roles; Pi's default
      // "developer" system role is rejected with HTTP 422.
      compat: { supportsDeveloperRole: false },
    })),
  });
}
