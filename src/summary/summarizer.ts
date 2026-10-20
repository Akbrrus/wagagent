import { config } from "../config.js";
import { logger } from "../logger.js";
import type { StoredMessage } from "../store/messageStore.js";
import { chatComplete } from "./llmClient.js";

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
  const lines = messages.map((m) => {
    const time = new Date(m.ts).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const name = m.senderName || m.sender.split("@")[0];
    return `[${time}] ${name}: ${m.text}`;
  });

  let transcript = lines.join("\n");

  // Untuk model konteks kecil (mis. Qwen 1.7B): jika terlalu panjang,
  // simpan hanya bagian TERBARU agar muat di context window.
  const limit = config.llmMaxInputChars;
  if (limit > 0 && transcript.length > limit) {
    transcript = transcript.slice(-limit);
    const firstNewline = transcript.indexOf("\n");
    if (firstNewline > 0) transcript = transcript.slice(firstNewline + 1);
    transcript = `…(pesan lama dipotong)…\n${transcript}`;
    logger.warn({ limit }, "Transkrip dipotong agar muat di context window model.");
  }

  return transcript;
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
  const user =
    language === "id"
      ? `Berikut transkrip chat grup "${groupName}" (${messages.length} pesan). Buat ringkasannya:\n\n${transcript}`
      : `Here is the chat transcript of group "${groupName}" (${messages.length} messages). Summarize it:\n\n${transcript}`;

  try {
    const text = await chatComplete({ system, user, maxTokens: 4000 });
    return text || (language === "id" ? "_Ringkasan kosong._" : "_Empty summary._");
  } catch (err) {
    logger.error({ err, groupName, provider: config.llmProvider }, "Gagal membuat ringkasan.");
    return language === "id"
      ? "⚠️ Gagal membuat ringkasan (error LLM). Cek log & konfigurasi provider."
      : "⚠️ Failed to create summary (LLM error). Check logs & provider config.";
  }
}
