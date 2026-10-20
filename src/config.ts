import "dotenv/config";
import path from "node:path";

/**
 * Konfigurasi statis dari environment variable.
 * Pengaturan yang bisa diubah saat runtime (lewat perintah "!") ada di store/settings.ts.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Environment variable ${name} wajib diisi.`);
  }
  return v;
}

/** Direktori data persisten (auth WhatsApp, settings, buffer pesan). */
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");

/**
 * Provider LLM untuk ringkasan:
 * - "anthropic" : Claude (pakai ANTHROPIC_API_KEY + CLAUDE_MODEL).
 * - "openai"    : endpoint kompatibel-OpenAI, mis. server Qwen lokal
 *                 (vLLM / Ollama / llama.cpp / LM Studio / TGI) lewat LLM_BASE_URL.
 */
export type LlmProvider = "anthropic" | "openai";
const llmProvider = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase() as LlmProvider;

// Validasi env sesuai provider yang dipilih.
if (llmProvider === "anthropic") {
  required("ANTHROPIC_API_KEY");
} else if (llmProvider === "openai") {
  required("LLM_BASE_URL");
  required("LLM_MODEL");
} else {
  throw new Error(`LLM_PROVIDER tidak valid: "${llmProvider}". Pilih "anthropic" atau "openai".`);
}

export const config = {
  dataDir: DATA_DIR,
  authDir: path.join(DATA_DIR, "auth"),
  settingsFile: path.join(DATA_DIR, "settings.json"),
  storeFile: path.join(DATA_DIR, "messages.json"),

  /** Provider LLM aktif. */
  llmProvider,

  // --- Provider: Anthropic (Claude) ---
  /** API key Claude (Anthropic). */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Model Claude untuk ringkasan. Default: Haiku terbaru. */
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-haiku-5-5",

  // --- Provider: OpenAI-compatible (mis. Qwen lokal) ---
  /** Base URL endpoint, mis. http://192.168.1.50:8000/v1 (vLLM) atau http://192.168.1.50:11434/v1 (Ollama). */
  llmBaseUrl: (process.env.LLM_BASE_URL ?? "").replace(/\/+$/, ""),
  /** API key endpoint (banyak server lokal tidak butuh; isi "sk-noauth" bila perlu). */
  llmApiKey: process.env.LLM_API_KEY ?? "",
  /** Nama model di server, mis. "Qwen/Qwen3-1.7B" (vLLM) atau "qwen3:1.7b" (Ollama). */
  llmModel: process.env.LLM_MODEL ?? "",
  /**
   * Batas karakter transkrip yang dikirim ke model (0 = tanpa batas).
   * Berguna untuk model konteks kecil seperti Qwen 1.7B; jika transkrip lebih
   * panjang, hanya pesan TERBARU yang dikirim.
   */
  llmMaxInputChars: Number(process.env.LLM_MAX_INPUT_CHARS ?? "0"),

  /**
   * Daftar nomor/JID yang boleh menjalankan perintah "!", dipisah koma.
   * Contoh: "6281234567890". Pesan dari akun sendiri (fromMe) selalu diizinkan.
   * Kosongkan untuk hanya mengizinkan akun sendiri.
   */
  ownerJids: (process.env.OWNER_JIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  /** Berapa lama pesan disimpan di buffer sebelum dibuang (jam). */
  retentionHours: Number(process.env.RETENTION_HOURS ?? "48"),

  /** Prefix perintah. */
  commandPrefix: process.env.COMMAND_PREFIX ?? "!",

  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;

/** Nilai default untuk settings runtime (dipakai saat file settings belum ada). */
export const defaultSettings = {
  /** Jam ringkasan harian otomatis, format "HH:MM" 24 jam. */
  summaryTime: process.env.DEFAULT_SUMMARY_TIME ?? "21:00",
  /** Timezone IANA untuk penjadwalan. */
  timezone: process.env.TZ ?? "Asia/Jakarta",
  /** Bahasa ringkasan: "id" atau "en". */
  language: (process.env.DEFAULT_LANGUAGE ?? "id") as "id" | "en",
  /** Apakah penjadwalan otomatis aktif secara global. */
  scheduleEnabled: true,
  /**
   * JID tujuan pengiriman ringkasan. Kosong = kirim ke chat diri sendiri
   * (Pesan ke diri sendiri). Bisa diubah ke grup/kontak lewat !settarget.
   */
  summaryTarget: "" as string,
  /** Grup yang di-exclude dari ringkasan otomatis (dipakai saat watchMode = "all"). */
  excludedGroups: [] as string[],
  /**
   * Mode pemilihan grup yang diringkas:
   * - "all"       : semua grup, kecuali yang ada di excludedGroups.
   * - "whitelist" : HANYA grup yang ada di whitelistGroups.
   */
  watchMode: "all" as "all" | "whitelist",
  /** Daftar JID grup yang di-whitelist (dipakai saat watchMode = "whitelist"). */
  whitelistGroups: [] as string[],
};

export type Settings = typeof defaultSettings;
