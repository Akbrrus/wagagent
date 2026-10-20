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

export const config = {
  dataDir: DATA_DIR,
  authDir: path.join(DATA_DIR, "auth"),
  settingsFile: path.join(DATA_DIR, "settings.json"),
  storeFile: path.join(DATA_DIR, "messages.json"),

  /** API key Claude (Anthropic). */
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  /** Model Claude untuk ringkasan. Default: Haiku terbaru. */
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-haiku-5-5",

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
  /** Grup yang di-exclude dari ringkasan otomatis (daftar JID). */
  excludedGroups: [] as string[],
};

export type Settings = typeof defaultSettings;
