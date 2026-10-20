import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { StoredMessage } from "../store/messageStore.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT_ID = `Kamu adalah asisten yang meringkas percakapan grup WhatsApp.
Tugasmu: baca transkrip chat lalu buat ringkasan yang padat dan mudah dibaca.
Aturan:
- Tulis dalam Bahasa Indonesia.
- Fokus pada topik penting, keputusan, pertanyaan yang belum terjawab, dan hal yang butuh tindakan (action item).
- Gunakan poin-poin (bullet) yang ringkas. Sebut nama orang bila relevan.
- Abaikan basa-basi, stiker, dan obrolan tidak penting.
- Jika ada jadwal, tanggal, atau angka penting, cantumkan.
- Jangan mengarang informasi yang tidak ada di transkrip.
- Maksimal sekitar 10 poin. Jika chat sepi, katakan singkat bahwa tidak banyak aktivitas.`;

const SYSTEM_PROMPT_EN = `You are an assistant that summarizes WhatsApp group conversations.
Your task: read the chat transcript and produce a concise, readable summary.
Rules:
- Write in English.
- Focus on key topics, decisions, open questions, and action items.
- Use short bullet points. Mention names where relevant.
- Ignore small talk, stickers, and noise.
- Include any schedules, dates, or important numbers.
- Do not invent information that is not in the transcript.
- Max ~10 bullets. If the chat is quiet, briefly say there wasn't much activity.`;

function buildTranscript(messages: StoredMessage[]): string {
  return messages
    .map((m) => {
      const time = new Date(m.ts).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const name = m.senderName || m.sender.split("@")[0];
      return `[${time}] ${name}: ${m.text}`;
    })
    .join("\n");
}

/**
 * Ringkas satu grup. Mengembalikan teks ringkasan siap kirim.
 */
export async function summarizeGroup(
  groupName: string,
  messages: StoredMessage[],
  language: "id" | "en",
): Promise<string> {
  if (messages.length === 0) {
    return language === "id"
      ? "_Tidak ada pesan pada periode ini._"
      : "_No messages in this period._";
  }

  const transcript = buildTranscript(messages);
  const system = language === "id" ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN;

  const userPrompt =
    language === "id"
      ? `Berikut transkrip chat grup "${groupName}" (${messages.length} pesan). Buat ringkasannya:\n\n${transcript}`
      : `Here is the chat transcript of group "${groupName}" (${messages.length} messages). Summarize it:\n\n${transcript}`;

  try {
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return text || (language === "id" ? "_Ringkasan kosong._" : "_Empty summary._");
  } catch (err) {
    logger.error({ err, groupName }, "Gagal membuat ringkasan via Claude.");
    if (err instanceof Anthropic.AuthenticationError) {
      return language === "id"
        ? "⚠️ Gagal: API key Claude tidak valid."
        : "⚠️ Failed: invalid Claude API key.";
    }
    if (err instanceof Anthropic.RateLimitError) {
      return language === "id"
        ? "⚠️ Gagal: kena rate limit Claude, coba lagi nanti."
        : "⚠️ Failed: Claude rate limit, try again later.";
    }
    return language === "id"
      ? "⚠️ Gagal membuat ringkasan (error API)."
      : "⚠️ Failed to create summary (API error).";
  }
}
