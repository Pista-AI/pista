import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@pista/protocol";

type ChatModel = Parameters<ModelRuntime["completeSimple"]>[0];

/**
 * "Auto" thinking, decided once per user message:
 * - Cloud reasoning models (Claude, Gemini, GPT reasoning) size their thinking themselves,
 *   so thinking simply stays on, as in their own apps.
 * - Local models think at full length even for "hello", so the same model is asked a quick
 *   yes/no question first (judgeNeedsThinking). The keyword rule below is only a fallback
 *   for when that call fails or times out.
 */
const NEEDS_THINKING = new RegExp(
  [
    // English
    "\\b(plan|design|architect|analy[sz]|compare|evaluate|review|debug|fix|refactor|implement|build|create|migrate|optimi[sz]|calculate|estimate|strategy|recommend|research|investigate|summari[sz]e|explain|prove|why|how)\\b",
    "\\b(step[- ]by[- ]step|trade-?offs?|pros and cons|root cause)\\b",
    // Swedish
    "\\b(planera|designa|analysera|jämför|utvärdera|granska|felsök|fixa|bygg|skapa|migrera|optimera|beräkna|uppskatta|strategi|rekommendera|undersök|sammanfatta|förklara|varför|hur)\\b",
  ].join("|"),
  "i",
);

/**
 * Fallback when the model judge is unavailable. A short question right after a turn that
 * needed thinking ("and what if…?") usually continues that reasoning.
 */
export function fallbackNeedsThinking(text: string, previousTurnThought: boolean): boolean {
  if (needsThinking(text)) return true;
  return previousTurnThought && /\?\s*$/.test(text.trim()) && text.length < 200;
}

export function needsThinking(text: string): boolean {
  const message = text.trim();
  if (message.length > 280) return true;
  if (/```|\n.*\n/.test(message)) return true; // code or multi-line instructions
  if (NEEDS_THINKING.test(message)) return true;
  return message.split(/\s+/).length > 25;
}

/** Map the decision onto what the current model supports. */
export function autoLevel(available: ThinkingLevel[], think: boolean): ThinkingLevel | undefined {
  if (available.length === 0) return undefined;
  if (!think) return available.includes("off") ? "off" : available[0];
  const preferred: ThinkingLevel[] = ["medium", "high", "low", "minimal", "xhigh"];
  return preferred.find((l) => available.includes(l)) ?? available[available.length - 1];
}

const JUDGE_SYSTEM =
  "You decide whether an AI assistant should reason step by step before replying to the user's newest message. Reply with exactly one word: yes or no.";

const JUDGE_GUIDE =
  "Answer yes if replying well needs planning, analysis, comparison, debugging, math, careful judgement, or several dependent steps. " +
  "Answer no for greetings, thanks, small talk, quick follow-ups, simple facts, or straightforward lookups.";

/** Asks the model itself, with thinking off and a tiny prompt, whether the message needs reasoning. */
export async function judgeNeedsThinking(
  runtime: ModelRuntime,
  model: ChatModel,
  history: string,
  message: string,
  // The judge answers in ~0.2-2s once warmed (see ThreadManager.warmJudge); if the server
  // is still busy, fall back rather than delay the reply further.
  timeoutMs = 3500,
): Promise<boolean> {
  const prompt = `${history ? `Recent conversation:\n${history}\n\n` : ""}Newest message:\n${message.slice(0, 2000)}\n\n${JUDGE_GUIDE}\nShould the assistant reason step by step before replying? yes or no:`;
  // Abort on timeout so an abandoned judge request doesn't sit in the server's queue.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reply;
  try {
    reply = await runtime.completeSimple(
      model,
      { systemPrompt: JUDGE_SYSTEM, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      { maxTokens: 8, signal: controller.signal },
    );
  } finally {
    clearTimeout(timer);
  }
  if (controller.signal.aborted || reply.stopReason === "aborted") throw new Error("judge timed out");
  const answer = reply.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join(" ")
    .trim()
    .toLowerCase();
  if (/^\W*(yes|ja)\b/.test(answer)) return true;
  if (/^\W*(no|nej)\b/.test(answer)) return false;
  throw new Error(`unclear judge answer: ${answer.slice(0, 40)}`);
}

/** Last few user/assistant texts, trimmed, as context for the judge. */
export function recentHistory(messages: readonly { role: string; content?: unknown }[], limit = 4): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((b: { type?: string; text?: string }) => (b.type === "text" ? (b.text ?? "") : "")).join(" ")
          : "";
    // Not text.ts clip: this takes Pi's untyped messages, drops images instead of writing "[image]", and cuts without an ellipsis.
    if (text.trim()) lines.push(`${m.role}: ${text.replace(/\s+/g, " ").trim().slice(0, 300)}`);
  }
  return lines.slice(-limit).join("\n");
}
