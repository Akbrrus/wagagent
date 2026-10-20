import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface StoredMessage {
  /** JID pengirim (misal 6281234@s.whatsapp.net). */
  sender: string;
  /** Nama tampilan pengirim (pushName) jika ada. */
  senderName: string;
  /** Isi teks pesan (sudah dinormalisasi dari berbagai tipe). */
  text: string;
  /** Epoch milliseconds. */
  ts: number;
}

interface StoreShape {
  /** groupJid -> daftar pesan. */
  groups: Record<string, StoredMessage[]>;
  /** groupJid -> nama grup (cache). */
  groupNames: Record<string, string>;
}

/**
 * Buffer pesan per grup, disimpan di memori dan dipersist ke JSON.
 * Pesan yang lebih tua dari retentionHours otomatis dibuang.
 */
class MessageStore {
  private data: StoreShape = { groups: {}, groupNames: {} };
  private saveTimer: NodeJS.Timeout | null = null;

  async load(): Promise<void> {
    try {
      const raw = await fsp.readFile(config.storeFile, "utf8");
      this.data = JSON.parse(raw) as StoreShape;
      if (!this.data.groups) this.data.groups = {};
      if (!this.data.groupNames) this.data.groupNames = {};
      this.prune();
      logger.info("Message store dimuat dari disk.");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error({ err }, "Gagal memuat message store.");
      }
    }
  }

  add(groupJid: string, msg: StoredMessage): void {
    (this.data.groups[groupJid] ??= []).push(msg);
    this.scheduleSave();
  }

  setGroupName(groupJid: string, name: string): void {
    if (name && this.data.groupNames[groupJid] !== name) {
      this.data.groupNames[groupJid] = name;
      this.scheduleSave();
    }
  }

  getGroupName(groupJid: string): string {
    return this.data.groupNames[groupJid] ?? groupJid;
  }

  /** Semua JID grup yang punya pesan tersimpan. */
  listGroups(): string[] {
    return Object.keys(this.data.groups).filter(
      (jid) => (this.data.groups[jid]?.length ?? 0) > 0,
    );
  }

  /** Ambil pesan sejak `sinceTs` (epoch ms) untuk satu grup. */
  getMessagesSince(groupJid: string, sinceTs: number): StoredMessage[] {
    return (this.data.groups[groupJid] ?? []).filter((m) => m.ts >= sinceTs);
  }

  /** Buang pesan lama di semua grup berdasarkan retentionHours. */
  prune(): void {
    const cutoff = Date.now() - config.retentionHours * 3600_000;
    for (const jid of Object.keys(this.data.groups)) {
      this.data.groups[jid] = (this.data.groups[jid] ?? []).filter(
        (m) => m.ts >= cutoff,
      );
    }
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    // Debounce 5 detik supaya tidak menulis disk tiap pesan.
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 5000);
  }

  private async save(): Promise<void> {
    try {
      await fsp.mkdir(path.dirname(config.storeFile), { recursive: true });
      await fsp.writeFile(
        config.storeFile,
        JSON.stringify(this.data),
        "utf8",
      );
    } catch (err) {
      logger.error({ err }, "Gagal menyimpan message store.");
    }
  }
}

export const messageStore = new MessageStore();
