import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { config, defaultSettings, type Settings } from "../config.js";
import { logger } from "../logger.js";

/**
 * Pengaturan runtime yang bisa diubah lewat perintah "!".
 * Disimpan ke file JSON agar tetap ada setelah restart container.
 */
class SettingsStore {
  private settings: Settings = { ...defaultSettings };

  async load(): Promise<void> {
    try {
      const raw = await fsp.readFile(config.settingsFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Merge supaya field baru dari defaultSettings tetap terisi.
      this.settings = { ...defaultSettings, ...parsed };
      logger.info("Settings dimuat dari disk.");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        logger.info("File settings belum ada, memakai default.");
        await this.save();
      } else {
        logger.error({ err }, "Gagal memuat settings, memakai default.");
      }
    }
  }

  get(): Readonly<Settings> {
    return this.settings;
  }

  async update(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.save();
  }

  private async save(): Promise<void> {
    await fsp.mkdir(path.dirname(config.settingsFile), { recursive: true });
    await fsp.writeFile(
      config.settingsFile,
      JSON.stringify(this.settings, null, 2),
      "utf8",
    );
  }
}

// Pastikan direktori data ada sejak awal.
fs.mkdirSync(config.dataDir, { recursive: true });

export const settingsStore = new SettingsStore();
