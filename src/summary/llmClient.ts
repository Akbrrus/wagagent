import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

/** Buang blok <think>…</think> (model thinking seperti Qwen3) dari hasil. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * Satu pintu untuk memanggil LLM, apa pun providernya.
 * - "anthropic" -> Claude via SDK resmi.
 * - "openai"    -> endpoint kompatibel-OpenAI (mis. Qwen di Ollama/vLLM).
 * Melempar Error bila gagal; pemanggil yang memberi pesan ramah ke user.
 */
export async function chatComplete(req: ChatRequest): Promise<string> {
  // Soft-switch untuk mematikan thinking pada model Qwen3.
  const user = config.llmDisableThinking ? `${req.user}\n\n/no_think` : req.user;
  const r: ChatRequest = { ...req, user };
  const out =
    config.llmProvider === "anthropic"
      ? await anthropicComplete(r)
      : await openaiComplete(r);
  return stripThink(out);
}

/** Label provider untuk log/pesan. */
export function providerLabel(): string {
  return config.llmProvider === "anthropic"
    ? `Claude (${config.claudeModel})`
    : `${config.llmModel} @ ${config.llmBaseUrl}`;
}

// --- Anthropic (Claude) ---

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  anthropic ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return anthropic;
}

async function anthropicComplete(req: ChatRequest): Promise<string> {
  const response = await getAnthropic().messages.create({
    model: config.claudeModel,
    max_tokens: req.maxTokens ?? config.llmMaxOutputTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
  });
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// --- OpenAI-compatible (Qwen lokal, dll.) ---

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

async function openaiComplete(req: ChatRequest): Promise<string> {
  const url = `${config.llmBaseUrl}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.llmApiKey) headers.Authorization = `Bearer ${config.llmApiKey}`;

  // Timeout manual supaya tidak menggantung bila VM model tidak merespons.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.llmModel,
        max_tokens: req.maxTokens ?? config.llmMaxOutputTokens,
        temperature: 0.3,
        stream: false,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} dari ${url}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    if (data.error?.message) throw new Error(data.error.message);
    return (data.choices?.[0]?.message?.content ?? "").trim();
  } finally {
    clearTimeout(timeout);
  }
}

// Info startup.
logger.info(
  { provider: config.llmProvider, disableThinking: config.llmDisableThinking },
  `LLM provider: ${providerLabel()}`,
);
