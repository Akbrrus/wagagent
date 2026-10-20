import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

/**
 * Satu pintu untuk memanggil LLM, apa pun providernya.
 * - "anthropic" -> Claude via SDK resmi.
 * - "openai"    -> endpoint kompatibel-OpenAI (mis. Qwen lokal di vLLM/Ollama).
 * Melempar Error bila gagal; pemanggil yang memberi pesan ramah ke user.
 */
export async function chatComplete(req: ChatRequest): Promise<string> {
  if (config.llmProvider === "anthropic") {
    return anthropicComplete(req);
  }
  return openaiComplete(req);
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
    max_tokens: req.maxTokens ?? 4000,
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
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.llmModel,
        max_tokens: req.maxTokens ?? 4000,
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
logger.info({ provider: config.llmProvider }, `LLM provider: ${providerLabel()}`);
